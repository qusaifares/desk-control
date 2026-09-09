import { exampleDeskConfig, JsonFileConfigStore, type DeskConfig } from '@desk-control/config';
import { InMemoryDiscoveryRegistry, NoopControllerAdvertiser } from '@desk-control/discovery';
import type { ControllerInfo } from '@desk-control/domain';
import { MockPeripheralSwitchProvider, type SimulatedSwitchSpec } from '@desk-control/hardware';
import { PROTOCOL_VERSION } from '@desk-control/protocol';
import { mkdir } from 'node:fs/promises';
import { CommandService } from './command-service.js';
import { loadControllerConfig } from './config.js';
import { DeskStore } from './desk-store.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const CONTROLLER_VERSION = '0.1.0';

/**
 * Peripheral switches are driven by the controller host itself (GPIO, serial or
 * USB-HID on the Pi). Only the simulator exists today; the spec below is
 * derived from user config so nothing about the switch is hardcoded.
 */
function switchSpecsFromConfig(config: DeskConfig): SimulatedSwitchSpec[] {
  return config.peripheralSwitches.map((peripheralSwitch) => {
    const ports = peripheralSwitch.ports.map((port) => port.id);
    const firstPort = ports[0] ?? 'port-1';
    return {
      switchId: peripheralSwitch.id,
      channels: peripheralSwitch.channels,
      ports,
      initialPorts: Object.fromEntries(
        peripheralSwitch.channels.map((channelId) => [channelId, firstPort]),
      ),
      switchDelayMs: 900,
    };
  });
}

async function main(): Promise<void> {
  const config = loadControllerConfig();
  const logger = createLogger(config.logLevel);

  await mkdir(config.dataDir, { recursive: true });
  const configStore = new JsonFileConfigStore(config.configPath);

  let deskConfig: DeskConfig;
  try {
    deskConfig = (await configStore.load()) ?? exampleDeskConfig();
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Falling back to the example desk config');
    deskConfig = exampleDeskConfig();
  }
  await configStore.save(deskConfig);

  const store = new DeskStore(deskConfig);
  const controllerInfo: ControllerInfo = {
    id: deskConfig.controller.id,
    name: deskConfig.controller.name,
    version: CONTROLLER_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    startedAt: new Date().toISOString(),
  };

  const peripheralProvider = new MockPeripheralSwitchProvider(switchSpecsFromConfig(deskConfig));

  // Seed peripheral observations so the UI shows real hardware truth at boot
  // rather than an optimistic guess.
  for (const state of await peripheralProvider.getObservedState()) {
    const peripheralSwitch = deskConfig.peripheralSwitches.find(
      (candidate) => candidate.id === state.switchId,
    );
    for (const peripheral of deskConfig.peripherals.filter((p) => p.switchId === state.switchId)) {
      const channelId = peripheral.channelId ?? peripheralSwitch?.channels[0] ?? 'default';
      const portId = state.activePorts[channelId] ?? null;
      store.setObservedPeripheral({
        peripheralId: peripheral.id,
        ownerComputerId:
          peripheralSwitch?.ports.find((port) => port.id === portId)?.computerId ?? null,
        reachability: state.reachability,
        observedAt: new Date().toISOString(),
        lastError: state.error,
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

  // Discovery is wired but intentionally inert: agents are told the controller
  // URL today. Swapping NoopControllerAdvertiser for an mDNS advertiser is the
  // only change needed to make agents find the controller by themselves.
  const advertiser = new NoopControllerAdvertiser();
  const registry = new InMemoryDiscoveryRegistry();
  void registry;

  await server.app.listen({ host: config.host, port: config.port });

  await advertiser.advertise({
    controllerId: controllerInfo.id,
    name: controllerInfo.name,
    host: config.host,
    port: config.port,
    agentUrl: `ws://${config.host}:${config.port}/agent`,
    protocolVersion: PROTOCOL_VERSION,
    discoveredVia: 'noop',
  });

  logger.info(
    {
      url: `http://${config.host}:${config.port}`,
      agentUrl: `ws://${config.host}:${config.port}/agent`,
      configPath: config.configPath,
    },
    'Desk controller ready',
  );

  if (config.host !== '127.0.0.1' && config.host !== 'localhost' && !config.pairingToken) {
    logger.warn(
      'Controller is bound beyond localhost with no pairing token set. ' +
        'Set DESK_CONTROL_PAIRING_TOKEN before using this on a shared network.',
    );
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down; desk hardware is left exactly as it is');
    await advertiser.stop();
    await server.close();
    // Persist user data only. Hardware facts are re-discovered on next boot.
    deskConfig.lastDesiredState = store.desired;
    await configStore.save(deskConfig);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
