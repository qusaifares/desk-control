import { AgentRuntime, WebSocketAgentTransport } from '@desk-control/agent-core';
import {
  EXAMPLE_COMPUTERS,
  EXAMPLE_MONITOR_SPECS,
  exampleDeskConfig,
  type DeskConfig,
} from '@desk-control/config';
import { StaticControllerDiscovery } from '@desk-control/discovery';
import type { ControllerInfo, DeskSnapshot } from '@desk-control/domain';
import {
  MockMonitorControlProvider,
  MockPeripheralSwitchProvider,
  SimulatedDesk,
} from '@desk-control/hardware';
import { PROTOCOL_VERSION } from '@desk-control/protocol';
import { waitFor } from '@desk-control/test-utils';
import type { AddressInfo } from 'node:net';
import pino from 'pino';
import { CommandService } from '../src/command-service.js';
import { loadControllerConfig } from '../src/config.js';
import { DeskStore } from '../src/desk-store.js';
import type { Logger } from '../src/logger.js';
import { createServer, type ControllerServer } from '../src/server.js';
import { buildSnapshot } from '../src/snapshot.js';

/**
 * Spins up a real controller (real Fastify, real WebSockets, real protocol
 * frames) talking to real AgentRuntimes over a simulated desk. Nothing about
 * the command path is stubbed - that is the point: this harness exercises the
 * same code the vertical slice runs.
 */
export interface Harness {
  store: DeskStore;
  server: ControllerServer;
  desk: SimulatedDesk;
  commands: CommandService;
  snapshot(): DeskSnapshot;
  port: number;
  stopAgent(computerId: string): Promise<void>;
  startAgent(computerId: string): Promise<void>;
  close(): Promise<void>;
}

const SWITCH_DELAY_MS = 40;

export async function createHarness(
  options: { configOverrides?: (config: DeskConfig) => DeskConfig; pairingToken?: string } = {},
): Promise<Harness> {
  const baseConfig = exampleDeskConfig();
  const deskConfig = options.configOverrides ? options.configOverrides(baseConfig) : baseConfig;

  const desk = new SimulatedDesk(
    EXAMPLE_MONITOR_SPECS.map((spec) => ({ ...spec, switchDelayMs: SWITCH_DELAY_MS })),
  );

  const store = new DeskStore(deskConfig);
  const logger = pino({ level: process.env.DESK_TEST_LOG ?? 'silent' }) as unknown as Logger;

  const config = loadControllerConfig({
    DESK_CONTROL_HOST: '127.0.0.1',
    DESK_CONTROL_PORT: '0',
    DESK_CONTROL_COMMAND_TIMEOUT_MS: '3000',
    DESK_CONTROL_HEARTBEAT_INTERVAL_MS: '500',
    DESK_CONTROL_OBSERVE_INTERVAL_MS: '150',
    DESK_CONTROL_AGENT_TIMEOUT_MS: '4000',
    ...(options.pairingToken ? { DESK_CONTROL_PAIRING_TOKEN: options.pairingToken } : {}),
  } as NodeJS.ProcessEnv);

  const controllerInfo: ControllerInfo = {
    id: deskConfig.controller.id,
    name: deskConfig.controller.name,
    version: '0.1.0-test',
    protocolVersion: PROTOCOL_VERSION,
    startedAt: new Date().toISOString(),
  };

  const peripheralProvider = new MockPeripheralSwitchProvider(
    deskConfig.peripheralSwitches.map((peripheralSwitch) => ({
      switchId: peripheralSwitch.id,
      channels: peripheralSwitch.channels,
      ports: peripheralSwitch.ports.map((port) => port.id),
      initialPorts: Object.fromEntries(
        peripheralSwitch.channels.map((channelId) => [
          channelId,
          peripheralSwitch.ports[0]?.id ?? 'port-1',
        ]),
      ),
      switchDelayMs: 10,
    })),
  );

  for (const state of await peripheralProvider.getObservedState()) {
    const peripheralSwitch = deskConfig.peripheralSwitches.find((s) => s.id === state.switchId);
    for (const peripheral of deskConfig.peripherals.filter((p) => p.switchId === state.switchId)) {
      const channelId = peripheral.channelId ?? peripheralSwitch?.channels[0] ?? 'default';
      const portId = state.activePorts[channelId] ?? null;
      store.setObservedPeripheral({
        peripheralId: peripheral.id,
        ownerComputerId: peripheralSwitch?.ports.find((p) => p.id === portId)?.computerId ?? null,
        reachability: state.reachability,
        observedAt: new Date().toISOString(),
        lastError: null,
      });
    }
  }

  const server = await createServer({
    store,
    config,
    controllerInfo,
    logger,
    commandServiceFactory: (gateway) =>
      new CommandService(store, gateway, peripheralProvider, config, logger),
  });

  await server.app.listen({ host: '127.0.0.1', port: 0 });
  const port = (server.app.server.address() as AddressInfo).port;

  const endpoint = {
    controllerId: controllerInfo.id,
    name: controllerInfo.name,
    host: '127.0.0.1',
    port,
    agentUrl: `ws://127.0.0.1:${port}/agent`,
    protocolVersion: PROTOCOL_VERSION,
    discoveredVia: 'test',
  };

  const runtimes = new Map<string, AgentRuntime>();
  for (const computer of EXAMPLE_COMPUTERS) {
    runtimes.set(
      computer.id,
      new AgentRuntime({
        agentId: computer.id.replace(/^computer:/, 'agent:'),
        computerId: computer.id,
        detectedName: `${computer.detectedName} agent`,
        computerDetectedName: computer.detectedName,
        platform: computer.platform,
        agentVersion: '0.1.0-test',
        capabilities: computer.capabilities,
        metadata: computer.metadata,
        provider: new MockMonitorControlProvider(desk, computer.id),
        discovery: new StaticControllerDiscovery([endpoint]),
        createTransport: () => new WebSocketAgentTransport(),
        ...(options.pairingToken ? { authToken: options.pairingToken } : {}),
        observeIntervalMs: 100,
        heartbeatIntervalMs: 500,
        reconnectDelayMs: 200,
      }),
    );
  }

  for (const runtime of runtimes.values()) await runtime.start();

  await waitFor(() => store.agents.size === EXAMPLE_COMPUTERS.length && store.monitors.size === 4, {
    message: 'agents did not register',
  });
  await waitFor(() => Object.keys(store.observedMonitors()).length === 4, {
    message: 'no observations arrived',
  });

  return {
    store,
    server,
    desk,
    commands: server.commands,
    port,
    snapshot: () => buildSnapshot(store, controllerInfo),
    async stopAgent(computerId: string) {
      await runtimes.get(computerId)?.stop();
    },
    async startAgent(computerId: string) {
      await runtimes.get(computerId)?.start();
    },
    async close() {
      for (const runtime of runtimes.values()) await runtime.stop();
      await server.close();
    },
  };
}
