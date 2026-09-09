import type {
  Computer,
  DeskCommand,
  Monitor,
  MonitorInput,
  ObservedMonitorState,
  Preset,
} from '@desk-control/domain';
import type { SimulatedMonitorSpec } from '@desk-control/hardware';

/**
 * Small builders so tests state only what they care about. Everything else gets
 * a boring, valid default - a test about failure handling should not have to
 * spell out an EDID.
 */
const now = () => new Date().toISOString();

export function aComputer(overrides: Partial<Computer> = {}): Computer {
  return {
    id: 'computer:test',
    kind: 'computer',
    detectedName: 'TEST-PC',
    customName: null,
    platform: 'windows',
    capabilities: ['ddc-control'],
    agentId: 'agent:test',
    connectivity: { state: 'online', lastSeenAt: now(), detail: null },
    metadata: {},
    ...overrides,
  };
}

export function anInput(overrides: Partial<MonitorInput> = {}): MonitorInput {
  return {
    id: 'input-dp1',
    connector: 'DisplayPort',
    ddcInputSourceValue: 0x0f,
    detectedName: 'DisplayPort 1',
    customName: null,
    connectedComputerId: 'computer:test',
    maxMode: null,
    ...overrides,
  };
}

export function aMonitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: 'monitor:test:1',
    kind: 'monitor',
    detectedName: 'TEST MON',
    customName: null,
    identity: {
      manufacturerId: 'TST',
      model: 'MON',
      serial: '0001',
      manufactureYear: 2024,
      weakIdentity: false,
    },
    capabilities: ['input-switch'],
    inputs: [anInput()],
    controlPaths: [],
    preferredInputId: null,
    placement: null,
    ...overrides,
  };
}

export function anObservedMonitor(
  overrides: Partial<ObservedMonitorState> = {},
): ObservedMonitorState {
  return {
    monitorId: 'monitor:test:1',
    activeInputId: 'input-dp1',
    activeSourceComputerId: 'computer:test',
    powerState: 'on',
    reachability: 'reachable',
    observedAt: now(),
    reportedByAgentId: 'agent:test',
    lastError: null,
    ...overrides,
  };
}

export function aCommand(overrides: Partial<DeskCommand> = {}): DeskCommand {
  return {
    id: 'command-1',
    payload: {
      kind: 'set-monitor-input',
      monitorId: 'monitor:test:1',
      inputId: 'input-dp1',
      sourceComputerId: 'computer:test',
    },
    status: 'dispatched',
    origin: 'user',
    presetId: null,
    agentId: 'agent:test',
    issuedAt: now(),
    updatedAt: now(),
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    attempts: 1,
    error: null,
    ...overrides,
  };
}

export function aPreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: 'preset:test',
    detectedName: 'Test preset',
    customName: null,
    description: null,
    icon: null,
    sortOrder: 0,
    assignments: { monitorSources: {}, peripheralOwners: {} },
    ...overrides,
  };
}

/** A two-input simulated monitor wired to two computers, switching instantly. */
export function aSimulatedMonitor(
  overrides: Partial<SimulatedMonitorSpec> = {},
): SimulatedMonitorSpec {
  return {
    stableId: 'monitor:test:1',
    detectedName: 'TEST MON',
    manufacturerId: 'TST',
    model: 'MON',
    serial: '0001',
    manufactureYear: 2024,
    capabilities: ['input-switch', 'read-active-input'],
    requiresActiveInput: true,
    switchDelayMs: 0,
    activeInputId: 'input-dp1',
    preferredInputId: 'input-dp1',
    inputs: [
      {
        id: 'input-dp1',
        connector: 'DisplayPort',
        ddcInputSourceValue: 0x0f,
        detectedName: 'DisplayPort 1',
        connectedComputerId: 'computer:a',
        maxMode: null,
      },
      {
        id: 'input-hdmi1',
        connector: 'HDMI',
        ddcInputSourceValue: 0x11,
        detectedName: 'HDMI 1',
        connectedComputerId: 'computer:b',
        maxMode: null,
      },
    ],
    ...overrides,
  };
}

/** Polls until a predicate holds; fails loudly instead of hanging silently. */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; message?: string } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(options.message ?? `waitFor timed out after ${timeoutMs}ms`);
}
