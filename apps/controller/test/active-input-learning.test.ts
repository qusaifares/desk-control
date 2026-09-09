import { emptyDeskConfig } from '@desk-control/config';
import { selectControlPath } from '@desk-control/domain';
import type { MonitorReport, ObservedMonitorReport } from '@desk-control/protocol';
import { describe, expect, it } from 'vitest';
import { DeskStore } from '../src/desk-store.js';

const MONITOR = 'monitor:aus:pa279cv:383842';

function report(connectedViaInputId: string): MonitorReport {
  return {
    stableId: MONITOR,
    localHandle: `handle:${connectedViaInputId}`,
    detectedName: 'AUS PA279CV',
    identity: {
      manufacturerId: 'AUS',
      model: 'PA279CV',
      serial: '383842',
      manufactureYear: 2021,
      weakIdentity: false,
    },
    capabilities: ['input-switch', 'read-active-input'],
    inputs: [
      {
        id: 'input-0x0f',
        connector: 'DisplayPort',
        ddcInputSourceValue: 0x0f,
        detectedName: 'DisplayPort 1',
        maxMode: null,
      },
      {
        id: 'input-0x12',
        connector: 'HDMI',
        ddcInputSourceValue: 0x12,
        detectedName: 'HDMI 2',
        maxMode: null,
      },
    ],
    connectedViaInputId,
    // Agents always report this conservatively.
    requiresActiveInput: true,
    preferredInputId: null,
  };
}

function observed(activeInputId: string | null): ObservedMonitorReport {
  return {
    stableId: MONITOR,
    activeInputId,
    powerState: activeInputId ? 'on' : 'unknown',
    reachability: activeInputId ? 'reachable' : 'unreachable',
    error: activeInputId ? null : { code: 'DEVICE_UNREACHABLE', message: 'no reply' },
  };
}

function storeWithTwoAgents() {
  const store = new DeskStore(emptyDeskConfig());
  store.applyMonitorReports('agent:pc', 'computer:pc', [report('input-0x0f')]);
  store.applyMonitorReports('agent:mac', 'computer:mac', [report('input-0x12')]);
  return store;
}

function pathFor(store: DeskStore, agentId: string) {
  return store.monitors.get(MONITOR)?.controlPaths.find((path) => path.agentId === agentId);
}

describe('learning that a panel answers DDC on an inactive input', () => {
  it('starts conservative: only the agent on the live input may drive the monitor', () => {
    const store = storeWithTwoAgents();
    const monitor = store.monitors.get(MONITOR)!;
    expect(monitor.controlPaths.every((path) => path.requiresActiveInput)).toBe(true);

    expect(
      selectControlPath(monitor, { activeInputId: 'input-0x12', isAgentOnline: () => true })
        ?.agentId,
    ).toBe('agent:mac');
  });

  it('proves independence when an agent reads the panel while another input is live', () => {
    const store = storeWithTwoAgents();
    // The PC is cabled to DisplayPort yet reads the panel fine while HDMI 2 is
    // live - exactly what a real ASUS panel on this desk turned out to do.
    store.applyObservedReports('agent:pc', [observed('input-0x12')]);
    expect(pathFor(store, 'agent:pc')?.requiresActiveInput).toBe(false);
  });

  it('lets a proved agent drive the monitor when the live-input agent is offline', () => {
    const store = storeWithTwoAgents();
    store.applyObservedReports('agent:pc', [observed('input-0x12')]);

    const chosen = selectControlPath(store.monitors.get(MONITOR)!, {
      activeInputId: 'input-0x12',
      isAgentOnline: (agentId) => agentId !== 'agent:mac',
    });
    // Before learning, this returned nothing and the command was refused.
    expect(chosen?.agentId).toBe('agent:pc');
  });

  it('proves nothing from an agent reading while it is itself the live input', () => {
    const store = storeWithTwoAgents();
    store.applyObservedReports('agent:mac', [observed('input-0x12')]);
    expect(pathFor(store, 'agent:mac')?.requiresActiveInput).toBe(true);
  });

  it('proves nothing from an unreachable observation', () => {
    const store = storeWithTwoAgents();
    store.applyObservedReports('agent:pc', [observed(null)]);
    expect(pathFor(store, 'agent:pc')?.requiresActiveInput).toBe(true);
  });

  it('keeps what it learned across a re-discovery', () => {
    const store = storeWithTwoAgents();
    store.applyObservedReports('agent:pc', [observed('input-0x12')]);

    // The agent reconnects and reports conservatively all over again.
    store.applyMonitorReports('agent:pc', 'computer:pc', [report('input-0x0f')]);
    expect(pathFor(store, 'agent:pc')?.requiresActiveInput).toBe(false);
  });
});
