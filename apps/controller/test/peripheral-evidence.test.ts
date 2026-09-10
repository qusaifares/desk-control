import { emptyDeskConfig } from '@desk-control/config';
import type { AgentHelloPayloadSchema } from '@desk-control/protocol';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { DeskStore } from '../src/desk-store.js';

const KEYBOARD_USB = '046d:c52b';

function hello(id: string): z.infer<typeof AgentHelloPayloadSchema> {
  return {
    agent: { id: `agent:${id}`, detectedName: id, agentVersion: '1', providerKind: 'mock' },
    computer: {
      id: `computer:${id}`,
      detectedName: id,
      platform: 'windows',
      capabilities: ['report-usb-devices'],
      metadata: {},
    },
    monitors: [],
    supportedCommandKinds: ['set-monitor-input'],
    authToken: null,
  };
}

function storeWithTwoAgents() {
  const config = emptyDeskConfig();
  config.peripheralSwitches = [
    {
      id: 'switch:kvm',
      kind: 'peripheral-switch',
      detectedName: 'KM switch',
      customName: null,
      capabilities: ['switch-port'],
      channels: ['default'],
      driverBinding: 'controller',
      ports: [
        { id: 'port-1', detectedName: 'Port 1', customName: null, computerId: 'computer:pc' },
        { id: 'port-2', detectedName: 'Port 2', customName: null, computerId: 'computer:mac' },
      ],
    },
  ];
  config.peripherals = [
    {
      id: 'peripheral:kb',
      kind: 'keyboard',
      detectedName: 'Shared Keyboard',
      customName: null,
      switchId: 'switch:kvm',
      channelId: 'default',
      usbId: KEYBOARD_USB,
    },
  ];

  const store = new DeskStore(config);
  store.registerAgent(hello('pc'), 1);
  store.registerAgent(hello('mac'), 1);
  return store;
}

describe('peripheral ownership from USB evidence', () => {
  it('says the keyboard is on whichever machine enumerates it', () => {
    const store = storeWithTwoAgents();
    store.applyUsbReport('agent:pc', [KEYBOARD_USB, '1d6b:0002']);
    store.applyUsbReport('agent:mac', ['1d6b:0002']);

    const observed = store.observedPeripherals()['peripheral:kb'];
    expect(observed?.ownerComputerId).toBe('computer:pc');
    expect(observed?.evidence).toBe('usb-enumeration');
  });

  it('follows the device when the switch actually moves it', () => {
    const store = storeWithTwoAgents();
    store.applyUsbReport('agent:pc', [KEYBOARD_USB]);
    store.applyUsbReport('agent:mac', []);
    expect(store.observedPeripherals()['peripheral:kb']?.ownerComputerId).toBe('computer:pc');

    store.applyUsbReport('agent:pc', []);
    store.applyUsbReport('agent:mac', [KEYBOARD_USB]);
    expect(store.observedPeripherals()['peripheral:kb']?.ownerComputerId).toBe('computer:mac');
  });

  it('reports unknown rather than guessing when nobody can see it', () => {
    const store = storeWithTwoAgents();
    store.applyUsbReport('agent:pc', []);
    store.applyUsbReport('agent:mac', []);

    // The keyboard is on a machine with no agent, or unplugged. Either way we
    // do not know, and saying so beats repeating what we last asked for.
    const observed = store.observedPeripherals()['peripheral:kb'];
    expect(observed?.ownerComputerId).toBeNull();
    expect(observed?.evidence).toBe('unknown');
  });

  it('refuses to pick a winner when two machines claim the same device', () => {
    const store = storeWithTwoAgents();
    store.applyUsbReport('agent:pc', [KEYBOARD_USB]);
    store.applyUsbReport('agent:mac', [KEYBOARD_USB]);

    const observed = store.observedPeripherals()['peripheral:kb'];
    expect(observed?.ownerComputerId).toBeNull();
    expect(observed?.evidence).toBe('unknown');
    expect(observed?.lastError?.code).toBe('AMBIGUOUS');
  });

  it('ignores a report from an agent that has since gone offline', () => {
    const store = storeWithTwoAgents();
    store.applyUsbReport('agent:pc', [KEYBOARD_USB]);
    expect(store.observedPeripherals()['peripheral:kb']?.ownerComputerId).toBe('computer:pc');

    // A machine that has gone quiet cannot vouch for what is still plugged in.
    store.setAgentOffline('agent:pc', 'offline', 'socket closed');
    expect(store.observedPeripherals()['peripheral:kb']?.ownerComputerId).toBeNull();
  });

  it('falls back to the switch when no agent can enumerate USB at all', () => {
    const store = storeWithTwoAgents();
    store.setObservedPeripheral({
      peripheralId: 'peripheral:kb',
      ownerComputerId: 'computer:pc',
      evidence: 'switch-report',
      reachability: 'reachable',
      observedAt: new Date().toISOString(),
      lastError: null,
    });

    const observed = store.observedPeripherals()['peripheral:kb'];
    expect(observed?.ownerComputerId).toBe('computer:pc');
    expect(observed?.evidence).toBe('switch-report');
  });
});
