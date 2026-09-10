import { emptyOverride, type DeskConfig, type EntityOverride } from '@desk-control/config';
import {
  captureDeskState,
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
  type Preset,
  type PresetAssignment,
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
  /** computerId -> USB devices that machine currently enumerates. */
  private readonly usbByComputer = new Map<string, Set<string>>();
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
      customName: this.overrideFor(id).customName,
      platform: (defaults?.platform ?? 'unknown') as Platform,
      capabilities: defaults?.capabilities ?? [],
      agentId: defaults?.agentId ?? null,
      connectivity: { state: 'unknown', lastSeenAt: null, detail: 'Never seen' },
      metadata: defaults?.metadata ?? {},
      appearance: {
        icon: this.overrideFor(id).icon,
        colorway: this.overrideFor(id).colorway,
      },
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
    computer.customName = this.overrideFor(payload.computer.id).customName;
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
        customName: this.overrideFor(report.stableId).customName,
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
        customName: this.overrideFor(`${report.stableId}:${input.id}`).customName,
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

  /**
   * Records what USB devices a machine can see.
   *
   * This is the evidence behind peripheral ownership. A KM switch of the usual
   * sort cannot say which port it selected, so the only real answer to "where
   * is the keyboard?" is which computer currently enumerates it.
   */
  applyUsbReport(agentId: string, devices: readonly string[]): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    this.usbByComputer.set(agent.computerId, new Set(devices.map((id) => id.toLowerCase())));
    this.touch();
  }

  /**
   * Which online computer holds a given USB device.
   *
   * Only online agents count: a machine that has gone quiet cannot vouch for
   * what is still plugged into it. Two machines claiming the same id - two
   * identical keyboards, or a hub - is ambiguous, and ambiguous is reported as
   * unknown rather than resolved by picking one.
   */
  private usbHolderOf(usbId: string): { computerId: string | null; ambiguous: boolean } {
    const wanted = usbId.toLowerCase();
    const holders = [...this.usbByComputer.entries()]
      .filter(([computerId, devices]) => {
        const computer = this.computers.get(computerId);
        const agentId = computer?.agentId;
        return (
          devices.has(wanted) &&
          agentId !== null &&
          agentId !== undefined &&
          this.isAgentOnline(agentId)
        );
      })
      .map(([computerId]) => computerId);

    if (holders.length === 1) return { computerId: holders[0]!, ambiguous: false };
    return { computerId: null, ambiguous: holders.length > 1 };
  }

  /** True once at least one online agent has told us what it can see. */
  private hasUsbEvidence(): boolean {
    for (const [computerId] of this.usbByComputer) {
      const agentId = this.computers.get(computerId)?.agentId;
      if (agentId && this.isAgentOnline(agentId)) return true;
    }
    return false;
  }

  setObservedPeripheral(state: ObservedPeripheralState): void {
    this.peripheralObservations.set(state.peripheralId, state);
    this.touch();
  }

  /**
   * Peripheral ownership, preferring what the computers report over what the
   * switch claims.
   *
   * A switch that can read its own port is still useful as a fallback, but USB
   * enumeration is a reading of the actual outcome rather than an account of
   * the action, so it wins wherever it is available.
   */
  observedPeripherals(): Record<string, ObservedPeripheralState> {
    const result: Record<string, ObservedPeripheralState> = {};
    const observedAt = new Date().toISOString();

    for (const peripheral of this.config.peripherals) {
      const fromSwitch = this.peripheralObservations.get(peripheral.id);

      if (peripheral.usbId && this.hasUsbEvidence()) {
        const holder = this.usbHolderOf(peripheral.usbId);
        result[peripheral.id] = {
          peripheralId: peripheral.id,
          ownerComputerId: holder.computerId,
          evidence: holder.computerId ? 'usb-enumeration' : 'unknown',
          reachability: holder.computerId ? 'reachable' : 'unknown',
          observedAt,
          lastError: holder.ambiguous
            ? {
                code: 'AMBIGUOUS',
                message: `More than one computer reports USB ${peripheral.usbId}`,
              }
            : null,
        };
        continue;
      }

      if (fromSwitch) {
        result[peripheral.id] = fromSwitch;
        continue;
      }

      // Neither the computers nor the switch can tell us. Say so explicitly
      // rather than omitting the peripheral, so the UI shows "unknown" instead
      // of quietly having nothing to render.
      result[peripheral.id] = {
        peripheralId: peripheral.id,
        ownerComputerId: null,
        evidence: 'unknown',
        reachability: 'unknown',
        observedAt,
        lastError: null,
      };
    }

    // Anything observed but no longer in config still gets reported as-is.
    for (const [peripheralId, state] of this.peripheralObservations) {
      if (!result[peripheralId]) result[peripheralId] = state;
    }
    return result;
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

  /** Reads an entity's overrides, defaulting rather than returning undefined. */
  overrideFor(entityId: string): EntityOverride {
    return this.config.overrides[entityId] ?? emptyOverride();
  }

  /**
   * Finds the live entity an override applies to.
   *
   * Ids are namespaced, so the type is implied rather than passed in. Monitor
   * inputs are the one composite: `<monitorId>:<inputId>`, split at the last
   * colon because an input id never contains one.
   */
  private entityExists(entityId: string): boolean {
    if (this.computers.has(entityId)) return true;
    if (this.monitors.has(entityId)) return true;
    if (this.config.peripherals.some((candidate) => candidate.id === entityId)) return true;
    if (this.config.presets.some((candidate) => candidate.id === entityId)) return true;

    const split = entityId.lastIndexOf(':');
    if (split > 0) {
      const monitor = this.monitors.get(entityId.slice(0, split));
      const inputId = entityId.slice(split + 1);
      if (monitor?.inputs.some((input) => input.id === inputId)) return true;
    }
    return false;
  }

  /**
   * Applies a presentation override.
   *
   * Presentation only: this can never change what a command does. Fields left
   * undefined are untouched; a field set to null is cleared, which is how a
   * custom name falls back to the detected one.
   */
  setOverride(entityId: string, patch: Partial<EntityOverride>): boolean {
    if (!this.entityExists(entityId)) return false;

    const next: EntityOverride = { ...this.overrideFor(entityId), ...patch };

    if (next.customName === null && next.icon === null && next.colorway === null) {
      delete this.config.overrides[entityId];
    } else {
      this.config.overrides[entityId] = next;
    }

    this.applyOverride(entityId, next);
    this.markConfigDirty();
    return true;
  }

  /** Pushes an override onto the live entity so the next snapshot reflects it. */
  private applyOverride(entityId: string, override: EntityOverride): void {
    const computer = this.computers.get(entityId);
    if (computer) {
      computer.customName = override.customName;
      computer.appearance = { icon: override.icon, colorway: override.colorway };
      return;
    }

    const monitor = this.monitors.get(entityId);
    if (monitor) {
      monitor.customName = override.customName;
      return;
    }

    const peripheral = this.config.peripherals.find((candidate) => candidate.id === entityId);
    if (peripheral) {
      peripheral.customName = override.customName;
      return;
    }

    const preset = this.config.presets.find((candidate) => candidate.id === entityId);
    if (preset) {
      preset.customName = override.customName;
      return;
    }

    const split = entityId.lastIndexOf(':');
    if (split > 0) {
      const owner = this.monitors.get(entityId.slice(0, split));
      const inputId = entityId.slice(split + 1);
      const input = owner?.inputs.find((candidate) => candidate.id === inputId);
      if (input) input.customName = override.customName;
    }
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
   * Unlike an override, this is a *fact assertion* and it drives routing:
   * discovery covers inputs an agent sits on, this covers the rest - a console,
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

  /* ---------------------------------------------------------------- *
   * Presets
   * ---------------------------------------------------------------- */

  /** Slug-based ids keep the config readable; a clash gets a numeric suffix. */
  private uniquePresetId(name: string): string {
    const base = `preset:${slugify(name) || 'preset'}`;
    if (!this.config.presets.some((preset) => preset.id === base)) return base;
    for (let suffix = 2; suffix < 500; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!this.config.presets.some((preset) => preset.id === candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
  }

  createPreset(input: {
    detectedName: string;
    description?: string | null;
    icon?: string | null;
    assignments: PresetAssignment;
  }): Preset {
    const preset: Preset = {
      id: this.uniquePresetId(input.detectedName),
      detectedName: input.detectedName,
      customName: null,
      description: input.description ?? null,
      icon: input.icon ?? null,
      sortOrder:
        this.config.presets.reduce((max, candidate) => Math.max(max, candidate.sortOrder), -1) + 1,
      assignments: input.assignments,
    };
    this.config.presets = [...this.config.presets, preset];
    this.markConfigDirty();
    return preset;
  }

  updatePreset(
    presetId: string,
    patch: { assignments?: PresetAssignment; description?: string | null; icon?: string | null },
  ): boolean {
    const preset = this.config.presets.find((candidate) => candidate.id === presetId);
    if (!preset) return false;
    if (patch.assignments) preset.assignments = patch.assignments;
    if (patch.description !== undefined) preset.description = patch.description;
    if (patch.icon !== undefined) preset.icon = patch.icon;
    this.markConfigDirty();
    return true;
  }

  deletePreset(presetId: string): boolean {
    const before = this.config.presets.length;
    this.config.presets = this.config.presets.filter((preset) => preset.id !== presetId);
    if (this.config.presets.length === before) return false;
    // A deleted preset must not stay flagged as the active one.
    if (this.desired.activePresetId === presetId) this.desired.activePresetId = null;
    this.markConfigDirty();
    return true;
  }

  /** Captures the desk as it is observed right now. */
  captureCurrentDesk() {
    return captureDeskState({
      monitors: [...this.monitors.values()],
      peripherals: this.config.peripherals,
      observedMonitors: this.observedMonitors(),
      observedPeripherals: this.observedPeripherals(),
    });
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
