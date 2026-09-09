import type { DeskConfig } from '@desk-control/config';
import {
  displayName,
  slugify,
  unionCapabilities,
  type Agent,
  type Computer,
  type ConnectivityState,
  type DeskCommand,
  type DesiredState,
  type Monitor,
  type MonitorInput,
  type ObservedMonitorState,
  type ObservedPeripheralState,
  type Placement,
  type Platform,
} from '@desk-control/domain';
import type {
  AgentHelloPayloadSchema,
  MonitorReport,
  ObservedMonitorReport,
} from '@desk-control/protocol';
import type { z } from 'zod';

type HelloPayload = z.infer<typeof AgentHelloPayloadSchema>;

interface ObservationRecord {
  report: ObservedMonitorReport;
  agentId: string;
  observedAt: string;
}

const MAX_RETAINED_COMMANDS = 100;

/**
 * Authoritative in-memory desk state.
 *
 * Hardware facts (monitors, capabilities, wiring) are rebuilt from agent
 * reports and are never persisted. User data (layout, names, presets) comes
 * from config. Desired and observed state are held side by side and never
 * merged - see resolveMonitorState in @desk-control/domain.
 */
export class DeskStore {
  private revisionCounter = 0;
  private readonly listeners = new Set<() => void>();
  /**
   * Separate from `listeners` on purpose: state changes fire several times a
   * second as observations arrive, while config changes are rare and are the
   * only thing that needs writing to disk.
   */
  private readonly configListeners = new Set<() => void>();

  readonly computers = new Map<string, Computer>();
  readonly agents = new Map<string, Agent>();
  readonly monitors = new Map<string, Monitor>();
  readonly commands = new Map<string, DeskCommand>();
  /** monitorId -> agentId -> latest observation from that agent. */
  private readonly observations = new Map<string, Map<string, ObservationRecord>>();
  private readonly peripheralObservations = new Map<string, ObservedPeripheralState>();
  /**
   * Best belief about which input is live on each monitor.
   *
   * Distinct from observed state on purpose: right after a switch every agent
   * is briefly unable to talk DDC (the new owner has not polled yet, the old
   * owner has lost access), and during that window the honest observation is
   * "unreachable". This belief is only ever used to choose which agent to route
   * the next command through - never to tell the user what is on screen.
   */
  private readonly lastKnownActiveInputs = new Map<string, string>();
  /**
   * `monitorId:agentId` pairs we have *proved* can talk DDC without holding the
   * live input.
   *
   * Agents report `requiresActiveInput: true` conservatively, because being
   * wrong that way costs a refused command while being wrong the other way
   * sends commands into a void. But plenty of panels answer DDC over an
   * inactive input, and when one demonstrably does we should stop pretending
   * otherwise - it widens the set of agents that can drive that monitor.
   *
   * A hardware fact, so it is never persisted: it is re-learned from scratch on
   * every boot rather than surviving a re-cabled desk.
   */
  private readonly provenActiveInputIndependence = new Set<string>();

  desired: DesiredState = { monitorSources: {}, peripheralOwners: {}, activePresetId: null };

  constructor(public config: DeskConfig) {
    this.seedComputersFromConfig();
  }

  get revision(): number {
    return this.revisionCounter;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Fires when persisted user data changes and should be written to disk. */
  subscribeConfig(listener: () => void): () => void {
    this.configListeners.add(listener);
    return () => this.configListeners.delete(listener);
  }

  /**
   * Marks user data dirty.
   *
   * Config used to be written only on a graceful shutdown, which meant a Pi
   * losing power lost every rename and every layout change since boot. Now each
   * edit signals immediately and the controller debounces the write.
   */
  private markConfigDirty(): void {
    for (const listener of this.configListeners) listener();
    this.touch();
  }

  touch(): void {
    this.revisionCounter += 1;
    for (const listener of this.listeners) listener();
  }

  /**
   * Computers named by the desk wiring exist even before their agent shows up:
   * a powered-off machine is still a valid routing target.
   */
  private seedComputersFromConfig(): void {
    const ids = new Set<string>();
    for (const peripheralSwitch of this.config.peripheralSwitches) {
      for (const port of peripheralSwitch.ports) {
        if (port.computerId) ids.add(port.computerId);
      }
    }
    for (const wiring of Object.values(this.config.wiringOverrides)) {
      for (const computerId of Object.values(wiring)) ids.add(computerId);
    }
    for (const id of ids) this.ensureComputer(id);

    // Machines the user declared by hand. They will never have an agent, so
    // their connectivity stays "unknown" rather than being called offline.
    for (const manual of this.config.manualComputers) {
      const computer = this.ensureComputer(manual.id, {
        detectedName: manual.detectedName,
        platform: manual.platform,
      });
      computer.detectedName = manual.detectedName;
      computer.platform = manual.platform;
      computer.metadata = { ...computer.metadata, declaredByUser: 'true' };
    }
  }

  private ensureComputer(id: string, defaults?: Partial<Computer>): Computer {
    const existing = this.computers.get(id);
    if (existing) return existing;
    const created: Computer = {
      id,
      kind: 'computer',
      detectedName: defaults?.detectedName ?? id.replace(/^computer:/, ''),
      customName: this.config.customNames.computers[id] ?? null,
      platform: (defaults?.platform ?? 'unknown') as Platform,
      capabilities: defaults?.capabilities ?? [],
      agentId: defaults?.agentId ?? null,
      connectivity: { state: 'unknown', lastSeenAt: null, detail: 'Never seen' },
      metadata: defaults?.metadata ?? {},
    };
    this.computers.set(id, created);
    return created;
  }

  /* ---------------------------------------------------------------- *
   * Agent lifecycle
   * ---------------------------------------------------------------- */

  registerAgent(payload: HelloPayload, protocolVersion: number): Agent {
    const now = new Date().toISOString();

    const computer = this.ensureComputer(payload.computer.id);
    computer.detectedName = payload.computer.detectedName;
    computer.customName = this.config.customNames.computers[payload.computer.id] ?? null;
    computer.platform = payload.computer.platform;
    computer.capabilities = payload.computer.capabilities;
    computer.metadata = payload.computer.metadata;
    computer.agentId = payload.agent.id;
    computer.connectivity = { state: 'online', lastSeenAt: now, detail: null };

    const agent: Agent = {
      id: payload.agent.id,
      computerId: payload.computer.id,
      detectedName: payload.agent.detectedName,
      customName: null,
      platform: payload.computer.platform,
      protocolVersion,
      agentVersion: payload.agent.agentVersion,
      providerKind: payload.agent.providerKind,
      supportedCommandKinds: payload.supportedCommandKinds,
      connectivity: { state: 'online', lastSeenAt: now, detail: null },
    };
    this.agents.set(agent.id, agent);

    this.applyMonitorReports(agent.id, payload.computer.id, payload.monitors);
    this.touch();
    return agent;
  }

  markAgentSeen(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    const now = new Date().toISOString();
    agent.connectivity = { state: 'online', lastSeenAt: now, detail: null };
    const computer = this.computers.get(agent.computerId);
    if (computer) computer.connectivity = { state: 'online', lastSeenAt: now, detail: null };
  }

  /**
   * Fail passive: losing an agent removes nothing. Monitors, wiring and the
   * last observations all stay exactly as they were - the desk has not changed,
   * only our ability to see it has.
   */
  setAgentOffline(agentId: string, state: ConnectivityState, detail: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.connectivity = { ...agent.connectivity, state, detail };
    const computer = this.computers.get(agent.computerId);
    if (computer) computer.connectivity = { ...computer.connectivity, state, detail };
    this.touch();
  }

  isAgentOnline(agentId: string): boolean {
    return this.agents.get(agentId)?.connectivity.state === 'online';
  }

  /** Whether an agent claimed it can carry out this kind of command. */
  agentSupportsCommand(agentId: string, kind: string): boolean {
    return this.agents.get(agentId)?.supportedCommandKinds.includes(kind) ?? false;
  }

  /* ---------------------------------------------------------------- *
   * Hardware inventory
   * ---------------------------------------------------------------- */

  applyMonitorReports(
    agentId: string,
    computerId: string,
    reports: readonly MonitorReport[],
  ): void {
    for (const report of reports) {
      const existing = this.monitors.get(report.stableId);
      const inputs = this.mergeInputs(report, existing, computerId);

      const controlPaths = (existing?.controlPaths ?? []).filter(
        (path) => path.agentId !== agentId,
      );
      controlPaths.push({
        agentId,
        computerId,
        localHandle: report.localHandle,
        inputId: report.connectedViaInputId,
        capabilities: report.capabilities,
        // A re-discovery must not throw away what we have already proved.
        requiresActiveInput:
          report.requiresActiveInput &&
          !this.provenActiveInputIndependence.has(`${report.stableId}:${agentId}`),
      });

      this.ensurePlacement(report.stableId);

      const monitor: Monitor = {
        id: report.stableId,
        kind: 'monitor',
        detectedName: report.detectedName,
        customName: this.config.customNames.monitors[report.stableId] ?? null,
        identity: report.identity,
        // Union: if any reachable path can do it, the monitor can do it.
        capabilities: unionCapabilities(controlPaths.map((path) => path.capabilities)),
        inputs,
        controlPaths,
        preferredInputId: report.preferredInputId ?? existing?.preferredInputId ?? null,
        placement: this.config.layout.placements[report.stableId] ?? null,
      };
      this.monitors.set(monitor.id, monitor);
    }
    this.touch();
  }

  /**
   * Gives a newly discovered monitor somewhere to live on the desk map.
   *
   * Without this, a real desk starts with an empty map and every monitor listed
   * as "not placed yet", which is useless on a touchscreen. Auto-placement lays
   * them out in a row and marks them, so the first thing the user does is drag
   * them into the right shape rather than build the desk from nothing.
   *
   * A placement the user has already made is never overwritten.
   */
  private ensurePlacement(monitorId: string): void {
    if (this.config.layout.placements[monitorId]) return;

    const existing = Object.values(this.config.layout.placements);
    const width = 16;
    const height = 9;
    const gap = 1;
    const nextX = existing.reduce((rightEdge, placement) => {
      return Math.max(rightEdge, placement.x + placement.width + gap);
    }, 0);

    this.config.layout.placements[monitorId] = {
      x: nextX,
      y: 0,
      width,
      height,
      orientation: 'landscape',
      autoPlaced: true,
    };

    this.config.layout.grid = {
      columns: Math.max(this.config.layout.grid.columns, nextX + width),
      rows: Math.max(this.config.layout.grid.rows, height),
    };
    this.markConfigDirty();
  }

  /**
   * Wiring discovery: an agent that can talk DDC over a cable knows which input
   * that cable occupies, so `connectedViaInputId` teaches us computer -> input.
   * Config overrides win, for inputs no agent can ever report (a console, a
   * laptop without an agent installed).
   */
  private mergeInputs(
    report: MonitorReport,
    existing: Monitor | undefined,
    computerId: string,
  ): MonitorInput[] {
    const overrides = this.config.wiringOverrides[report.stableId] ?? {};
    return report.inputs.map((input) => {
      const previous = existing?.inputs.find((candidate) => candidate.id === input.id);
      let connectedComputerId = previous?.connectedComputerId ?? null;
      if (report.connectedViaInputId === input.id) connectedComputerId = computerId;
      if (overrides[input.id]) connectedComputerId = overrides[input.id] ?? null;
      if (connectedComputerId) this.ensureComputer(connectedComputerId);

      return {
        id: input.id,
        connector: input.connector,
        ddcInputSourceValue: input.ddcInputSourceValue,
        detectedName: input.detectedName,
        customName: this.config.customNames.monitorInputs[`${report.stableId}:${input.id}`] ?? null,
        connectedComputerId,
        maxMode: input.maxMode,
      };
    });
  }

  /* ---------------------------------------------------------------- *
   * Observations
   * ---------------------------------------------------------------- */

  applyObservedReports(agentId: string, reports: readonly ObservedMonitorReport[]): void {
    const observedAt = new Date().toISOString();
    for (const report of reports) {
      const perMonitor =
        this.observations.get(report.stableId) ?? new Map<string, ObservationRecord>();
      perMonitor.set(agentId, { report, agentId, observedAt });
      this.observations.set(report.stableId, perMonitor);
      if (report.reachability === 'reachable' && report.activeInputId) {
        this.noteActiveInput(report.stableId, report.activeInputId);
        this.noteActiveInputIndependence(report.stableId, agentId, report.activeInputId);
      }
    }
    this.touch();
  }

  /**
   * Several agents can see one monitor, and usually only one of them has DDC
   * access at a time. A reachable report always beats an unreachable one; among
   * equals, the newest wins.
   */
  effectiveObservedMonitor(monitorId: string): ObservedMonitorState | undefined {
    const perMonitor = this.observations.get(monitorId);
    if (!perMonitor || perMonitor.size === 0) return undefined;

    const records = [...perMonitor.values()].sort((a, b) => {
      const aReachable = a.report.reachability === 'reachable' ? 1 : 0;
      const bReachable = b.report.reachability === 'reachable' ? 1 : 0;
      if (aReachable !== bReachable) return bReachable - aReachable;
      return b.observedAt.localeCompare(a.observedAt);
    });

    const best = records[0];
    if (!best) return undefined;

    const monitor = this.monitors.get(monitorId);
    const activeInputId = best.report.activeInputId;
    const activeSourceComputerId =
      activeInputId === null
        ? null
        : (monitor?.inputs.find((input) => input.id === activeInputId)?.connectedComputerId ??
          null);

    return {
      monitorId,
      activeInputId,
      activeSourceComputerId,
      powerState: best.report.powerState,
      brightness: best.report.brightness,
      reachability: best.report.reachability,
      observedAt: best.observedAt,
      reportedByAgentId: best.agentId,
      lastError: best.report.error,
    };
  }

  /**
   * An agent that reads a monitor while some *other* input is live has just
   * proved it does not need the active input. Record it and widen that control
   * path immediately, rather than waiting for the next inventory.
   */
  private noteActiveInputIndependence(
    monitorId: string,
    agentId: string,
    observedActiveInputId: string,
  ): void {
    const monitor = this.monitors.get(monitorId);
    const path = monitor?.controlPaths.find((candidate) => candidate.agentId === agentId);
    if (!monitor || !path || !path.requiresActiveInput) return;
    // Unknown wiring proves nothing; the agent may well be on the live input.
    if (path.inputId === null || path.inputId === observedActiveInputId) return;

    this.provenActiveInputIndependence.add(`${monitorId}:${agentId}`);
    path.requiresActiveInput = false;
  }

  noteActiveInput(monitorId: string, inputId: string): void {
    this.lastKnownActiveInputs.set(monitorId, inputId);
  }

  /** Routing hint only. See lastKnownActiveInputs. */
  bestKnownActiveInput(monitorId: string): string | null {
    const observed = this.effectiveObservedMonitor(monitorId);
    if (observed?.reachability === 'reachable' && observed.activeInputId) {
      return observed.activeInputId;
    }
    return this.lastKnownActiveInputs.get(monitorId) ?? observed?.activeInputId ?? null;
  }

  /** The computer behind bestKnownActiveInput, for dimmed "last seen" display. */
  lastKnownSourceComputerId(monitorId: string): string | null {
    const inputId = this.bestKnownActiveInput(monitorId);
    if (!inputId) return null;
    const monitor = this.monitors.get(monitorId);
    return monitor?.inputs.find((input) => input.id === inputId)?.connectedComputerId ?? null;
  }

  observedMonitors(): Record<string, ObservedMonitorState> {
    const result: Record<string, ObservedMonitorState> = {};
    for (const monitorId of this.observations.keys()) {
      const observed = this.effectiveObservedMonitor(monitorId);
      if (observed) result[monitorId] = observed;
    }
    return result;
  }

  setObservedPeripheral(state: ObservedPeripheralState): void {
    this.peripheralObservations.set(state.peripheralId, state);
    this.touch();
  }

  observedPeripherals(): Record<string, ObservedPeripheralState> {
    return Object.fromEntries(this.peripheralObservations);
  }

  /* ---------------------------------------------------------------- *
   * Commands
   * ---------------------------------------------------------------- */

  putCommand(command: DeskCommand): void {
    this.commands.set(command.id, command);
    this.pruneCommands();
    this.touch();
  }

  updateCommand(id: string, patch: Partial<DeskCommand>): DeskCommand | undefined {
    const existing = this.commands.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.commands.set(id, updated);
    this.touch();
    return updated;
  }

  listCommands(): DeskCommand[] {
    return [...this.commands.values()].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  }

  private pruneCommands(): void {
    if (this.commands.size <= MAX_RETAINED_COMMANDS) return;
    const sorted = this.listCommands();
    for (const command of sorted.slice(MAX_RETAINED_COMMANDS)) {
      this.commands.delete(command.id);
    }
  }

  /* ---------------------------------------------------------------- *
   * Names
   * ---------------------------------------------------------------- */

  setCustomName(
    entityType: 'computer' | 'monitor' | 'peripheral' | 'preset',
    entityId: string,
    customName: string | null,
  ): boolean {
    const assign = (bucket: Record<string, string>) => {
      if (customName === null) delete bucket[entityId];
      else bucket[entityId] = customName;
    };

    switch (entityType) {
      case 'computer': {
        const computer = this.computers.get(entityId);
        if (!computer) return false;
        assign(this.config.customNames.computers);
        computer.customName = customName;
        break;
      }
      case 'monitor': {
        const monitor = this.monitors.get(entityId);
        if (!monitor) return false;
        assign(this.config.customNames.monitors);
        monitor.customName = customName;
        break;
      }
      case 'peripheral': {
        const peripheral = this.config.peripherals.find((candidate) => candidate.id === entityId);
        if (!peripheral) return false;
        assign(this.config.customNames.peripherals);
        peripheral.customName = customName;
        break;
      }
      case 'preset': {
        const preset = this.config.presets.find((candidate) => candidate.id === entityId);
        if (!preset) return false;
        preset.customName = customName;
        break;
      }
    }
    this.markConfigDirty();
    return true;
  }

  /**
   * Moves a monitor on the desk map.
   *
   * The layout is user data and is stored separately from hardware, so
   * re-detecting a monitor never moves it and moving it never rewrites a
   * hardware fact.
   */
  setPlacement(monitorId: string, placement: Placement): boolean {
    const monitor = this.monitors.get(monitorId);
    if (!monitor) return false;

    const stored: Placement = { ...placement, autoPlaced: false };
    this.config.layout.placements[monitorId] = stored;
    monitor.placement = stored;

    this.config.layout.grid = {
      columns: Math.max(this.config.layout.grid.columns, Math.ceil(stored.x + stored.width)),
      rows: Math.max(this.config.layout.grid.rows, Math.ceil(stored.y + stored.height)),
    };
    this.markConfigDirty();
    return true;
  }

  /**
   * Declares what is plugged into a monitor input.
   *
   * Discovery covers inputs an agent sits on; this covers the rest - a console,
   * or a laptop with nothing installed. A user override always beats what
   * discovery inferred.
   */
  setWiringOverride(monitorId: string, inputId: string, computerId: string | null): boolean {
    const monitor = this.monitors.get(monitorId);
    const input = monitor?.inputs.find((candidate) => candidate.id === inputId);
    if (!monitor || !input) return false;
    if (computerId !== null && !this.computers.has(computerId)) return false;

    const overrides = this.config.wiringOverrides[monitorId] ?? {};
    if (computerId === null) delete overrides[inputId];
    else overrides[inputId] = computerId;

    if (Object.keys(overrides).length === 0) delete this.config.wiringOverrides[monitorId];
    else this.config.wiringOverrides[monitorId] = overrides;

    input.connectedComputerId = computerId;
    this.markConfigDirty();
    return true;
  }

  /** Adds a source that will never report itself. Returns the new computer. */
  declareComputer(detectedName: string, platform: Platform): Computer {
    const id = `computer:manual:${slugify(detectedName)}`;
    this.config.manualComputers = [
      ...this.config.manualComputers.filter((candidate) => candidate.id !== id),
      { id, detectedName, platform },
    ];
    const computer = this.ensureComputer(id, { detectedName, platform });
    computer.detectedName = detectedName;
    computer.platform = platform;
    computer.metadata = { ...computer.metadata, declaredByUser: 'true' };
    this.markConfigDirty();
    return computer;
  }

  /** Convenience for logs. */
  label(id: string): string {
    const computer = this.computers.get(id);
    if (computer) return displayName(computer);
    const monitor = this.monitors.get(id);
    if (monitor) return displayName(monitor);
    return id;
  }
}
