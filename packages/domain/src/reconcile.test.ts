import { describe, expect, it } from 'vitest';
import type { DeskCommand } from './command.js';
import { aggregateStatus, resolveMonitorState, resolvePeripheralState } from './reconcile.js';
import type { DesiredMonitorSource, ObservedMonitorState } from './state.js';

const desired = (
  sourceComputerId: string,
  commandId: string | null = null,
): DesiredMonitorSource => ({
  monitorId: 'monitor:1',
  sourceComputerId,
  requestedAt: '2026-01-01T00:00:00.000Z',
  origin: 'user',
  commandId,
  presetId: null,
});

const observed = (overrides: Partial<ObservedMonitorState> = {}): ObservedMonitorState => ({
  monitorId: 'monitor:1',
  activeInputId: 'input-dp1',
  activeSourceComputerId: 'computer:a',
  powerState: 'on',
  brightness: null,
  reachability: 'reachable',
  observedAt: '2026-01-01T00:00:01.000Z',
  reportedByAgentId: 'agent:a',
  lastError: null,
  ...overrides,
});

const command = (overrides: Partial<DeskCommand> = {}): DeskCommand => ({
  id: 'cmd-1',
  payload: {
    kind: 'set-monitor-input',
    monitorId: 'monitor:1',
    inputId: 'input-hdmi1',
    sourceComputerId: 'computer:b',
  },
  status: 'dispatched',
  origin: 'user',
  presetId: null,
  agentId: 'agent:a',
  issuedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deadlineAt: '2026-01-01T00:00:12.000Z',
  attempts: 1,
  error: null,
  ...overrides,
});

describe('resolveMonitorState', () => {
  it('reports unknown when hardware has never been observed', () => {
    const result = resolveMonitorState({
      desired: desired('computer:a'),
      observed: null,
      command: null,
    });
    expect(result.status).toBe('unknown');
    // Desired intent survives even when we cannot see the hardware.
    expect(result.desiredSourceComputerId).toBe('computer:a');
  });

  it('reports in-sync when observed matches desired', () => {
    const result = resolveMonitorState({
      desired: desired('computer:a'),
      observed: observed(),
      command: null,
    });
    expect(result.status).toBe('in-sync');
  });

  it('treats an in-flight command as switching even though observed still shows the old source', () => {
    const result = resolveMonitorState({
      desired: desired('computer:b', 'cmd-1'),
      observed: observed({ activeSourceComputerId: 'computer:a' }),
      command: command({ status: 'dispatched' }),
    });
    expect(result.status).toBe('switching');
    expect(result.inFlightCommandId).toBe('cmd-1');
    // The headline stays honest: hardware is still on computer:a.
    expect(result.observedSourceComputerId).toBe('computer:a');
  });

  it('reports failed when the command ended badly and hardware never moved', () => {
    const result = resolveMonitorState({
      desired: desired('computer:b', 'cmd-1'),
      observed: observed({ activeSourceComputerId: 'computer:a' }),
      command: command({
        status: 'failed',
        error: { code: 'DEVICE_UNREACHABLE', message: 'no DDC', retryable: true },
      }),
    });
    expect(result.status).toBe('failed');
    expect(result.error).toEqual({ code: 'DEVICE_UNREACHABLE', message: 'no DDC' });
  });

  it('reports in-sync when a command failed but the hardware reached the target anyway', () => {
    const result = resolveMonitorState({
      desired: desired('computer:b', 'cmd-1'),
      observed: observed({ activeSourceComputerId: 'computer:b' }),
      command: command({ status: 'timed-out' }),
    });
    expect(result.status).toBe('in-sync');
  });

  it('distinguishes drift (someone used the monitor buttons) from failure', () => {
    const result = resolveMonitorState({
      desired: desired('computer:b'),
      observed: observed({ activeSourceComputerId: 'computer:c' }),
      command: null,
    });
    expect(result.status).toBe('drifted');
  });

  it('reports unreachable with the underlying error', () => {
    const result = resolveMonitorState({
      desired: desired('computer:a'),
      observed: observed({
        reachability: 'unreachable',
        lastError: { code: 'DEVICE_UNREACHABLE', message: 'DDC only answers on the active input' },
      }),
      command: null,
    });
    expect(result.status).toBe('unreachable');
    expect(result.error?.code).toBe('DEVICE_UNREACHABLE');
  });

  it('treats an observation with no desire as in-sync rather than drifted', () => {
    const result = resolveMonitorState({ desired: null, observed: observed(), command: null });
    expect(result.status).toBe('in-sync');
    expect(result.desiredSourceComputerId).toBeNull();
  });
});

describe('resolvePeripheralState', () => {
  it('applies the same rules to peripheral ownership', () => {
    const result = resolvePeripheralState({
      desired: {
        peripheralId: 'peripheral:kb',
        ownerComputerId: 'computer:b',
        requestedAt: '2026-01-01T00:00:00.000Z',
        origin: 'preset',
        commandId: 'cmd-1',
        presetId: 'preset:work',
      },
      observed: {
        peripheralId: 'peripheral:kb',
        ownerComputerId: 'computer:a',
        evidence: 'usb-enumeration' as const,
        reachability: 'reachable',
        observedAt: '2026-01-01T00:00:01.000Z',
        lastError: null,
      },
      command: command({ status: 'acked' }),
    });
    expect(result.status).toBe('switching');
    expect(result.observedOwnerComputerId).toBe('computer:a');
    expect(result.desiredOwnerComputerId).toBe('computer:b');
  });
});

describe('aggregateStatus', () => {
  it('surfaces the most actionable status across a preset', () => {
    expect(aggregateStatus(['in-sync', 'switching', 'in-sync'])).toBe('switching');
    expect(aggregateStatus(['in-sync', 'failed', 'switching'])).toBe('switching');
    expect(aggregateStatus(['in-sync', 'failed'])).toBe('failed');
    expect(aggregateStatus(['in-sync', 'in-sync'])).toBe('in-sync');
    expect(aggregateStatus([])).toBe('unknown');
  });
});
