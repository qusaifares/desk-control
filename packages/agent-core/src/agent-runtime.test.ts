import { StaticControllerDiscovery, type ControllerEndpoint } from '@desk-control/discovery';
import { MockMonitorControlProvider, SimulatedDesk } from '@desk-control/hardware';
import { buildMessage, PROTOCOL_VERSION } from '@desk-control/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRuntime } from './agent-runtime.js';
import { InMemoryAgentTransport } from './transport.js';

const endpoint: ControllerEndpoint = {
  controllerId: 'controller:test',
  name: 'Test',
  host: '127.0.0.1',
  port: 1,
  agentUrl: 'ws://127.0.0.1:1/agent',
  protocolVersion: PROTOCOL_VERSION,
  discoveredVia: 'test',
};

function makeDesk() {
  return new SimulatedDesk([
    {
      stableId: 'monitor:1',
      detectedName: 'MON',
      manufacturerId: 'TST',
      model: 'MON',
      serial: '1',
      manufactureYear: 2024,
      capabilities: ['input-switch'],
      requiresActiveInput: true,
      switchDelayMs: 0,
      activeInputId: 'input-dp1',
      preferredInputId: 'input-dp1',
      inputs: [
        {
          id: 'input-dp1',
          connector: 'DisplayPort',
          ddcInputSourceValue: 0x0f,
          detectedName: 'DP1',
          connectedComputerId: 'computer:a',
          maxMode: null,
        },
        {
          id: 'input-hdmi1',
          connector: 'HDMI',
          ddcInputSourceValue: 0x11,
          detectedName: 'HDMI1',
          connectedComputerId: 'computer:b',
          maxMode: null,
        },
      ],
    },
  ]);
}

async function startRuntime() {
  const desk = makeDesk();
  const transport = new InMemoryAgentTransport();
  const runtime = new AgentRuntime({
    agentId: 'agent:a',
    computerId: 'computer:a',
    detectedName: 'agent',
    computerDetectedName: 'PC-A',
    platform: 'windows',
    agentVersion: '0.1.0',
    capabilities: ['ddc-control'],
    provider: new MockMonitorControlProvider(desk, 'computer:a'),
    discovery: new StaticControllerDiscovery([endpoint]),
    createTransport: () => transport,
  });
  await runtime.start();
  transport.deliver(
    buildMessage('controller.welcome', {
      controller: {
        id: 'controller:test',
        name: 'Test',
        version: '0.1.0',
        protocolVersion: PROTOCOL_VERSION,
        startedAt: new Date().toISOString(),
      },
      sessionId: 'session-1',
      heartbeatIntervalMs: 60_000,
      commandTimeoutMs: 5_000,
      observeIntervalMs: 60_000,
    }),
  );
  return { desk, transport, runtime };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('AgentRuntime', () => {
  it('opens exactly one connection even though discovery also fires on start', async () => {
    const started = await startRuntime();
    cleanup = () => started.runtime.stop();
    await flush();
    // Two hellos would make the controller tear down and rebuild the session.
    expect(started.transport.sentOfType<any>('agent.hello')).toHaveLength(1);
  });

  it('reports what it discovers, including which input its own cable is on', async () => {
    const started = await startRuntime();
    cleanup = () => started.runtime.stop();
    const hello = started.transport.sentOfType<any>('agent.hello')[0];
    expect(hello?.payload.monitors[0].stableId).toBe('monitor:1');
    expect(hello?.payload.monitors[0].connectedViaInputId).toBe('input-dp1');
  });

  it('acks, executes, then reports the state it read back from hardware', async () => {
    const started = await startRuntime();
    cleanup = () => started.runtime.stop();

    started.transport.deliver(
      buildMessage('controller.command', {
        commandId: 'cmd-1',
        payload: {
          kind: 'set-monitor-input',
          monitorId: 'monitor:1',
          inputId: 'input-hdmi1',
          sourceComputerId: 'computer:b',
        },
        deadlineAt: new Date(Date.now() + 5000).toISOString(),
      }),
    );
    await flush();

    expect(started.transport.sentOfType<any>('agent.command-ack')[0]?.payload.commandId).toBe(
      'cmd-1',
    );
    const result = started.transport.sentOfType<any>('agent.command-result')[0];
    expect(result?.payload.ok).toBe(true);
    expect(started.desk.get('monitor:1')?.activeInputId).toBe('input-hdmi1');
    // Having given the input away, this agent can no longer see the monitor -
    // and says so instead of echoing the value it just wrote.
    expect(result?.payload.observed[0].reachability).toBe('unreachable');
    expect(result?.payload.observed[0].activeInputId).toBeNull();
  });

  it('treats a redelivered command id as idempotent', async () => {
    const started = await startRuntime();
    cleanup = () => started.runtime.stop();

    const command = buildMessage('controller.command', {
      commandId: 'cmd-1',
      payload: {
        kind: 'set-monitor-input',
        monitorId: 'monitor:1',
        inputId: 'input-hdmi1',
        sourceComputerId: 'computer:b',
      },
      deadlineAt: new Date(Date.now() + 5000).toISOString(),
    });

    started.transport.deliver(command);
    await flush();
    // Simulate the panel being changed by hand in between.
    const monitor = started.desk.get('monitor:1');
    if (monitor) monitor.activeInputId = 'input-dp1';

    started.transport.deliver(command);
    await flush();

    expect(started.desk.get('monitor:1')?.activeInputId).toBe('input-dp1');
    expect(started.transport.sentOfType<any>('agent.command-result')).toHaveLength(2);
    expect(started.transport.sentOfType<any>('agent.command-result')[1]?.payload.ok).toBe(true);
  });

  it('refuses a command kind it cannot execute with a typed error', async () => {
    const started = await startRuntime();
    cleanup = () => started.runtime.stop();

    started.transport.deliver(
      buildMessage('controller.command', {
        commandId: 'cmd-2',
        payload: {
          kind: 'set-peripheral-owner',
          switchId: 'switch:1',
          channelId: 'default',
          portId: 'port-1',
          peripheralIds: [],
          ownerComputerId: 'computer:b',
        },
        deadlineAt: new Date(Date.now() + 5000).toISOString(),
      }),
    );
    await flush();

    const result = started.transport.sentOfType<any>('agent.command-result')[0];
    expect(result?.payload.ok).toBe(false);
    expect(result?.payload.error.code).toBe('UNKNOWN_COMMAND_KIND');
  });

  it('rejects an unparseable controller frame instead of acting on it', async () => {
    const started = await startRuntime();
    cleanup = () => started.runtime.stop();

    started.transport.deliver({ type: 'controller.command', payload: { do: 'anything' } });
    await flush();

    expect(started.transport.sentOfType<any>('agent.error')[0]?.payload.code).toBe(
      'INVALID_MESSAGE',
    );
    expect(started.transport.sentOfType<any>('agent.command-ack')).toHaveLength(0);
  });
});
