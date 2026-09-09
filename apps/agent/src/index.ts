import { hostname, platform as osPlatform } from 'node:os';
import { AgentRuntime, WebSocketAgentTransport } from '@desk-control/agent-core';
import { StaticControllerDiscovery } from '@desk-control/discovery';
import {
  buildAgentId,
  buildComputerId,
  type ComputerCapability,
  type Platform,
} from '@desk-control/domain';
import {
  createPlatformProvider,
  isWsl,
  MockMonitorControlProvider,
  PlatformProviderNotImplementedError,
  SimulatedDesk,
  type MonitorControlProvider,
  type PlatformProviderKind,
} from '@desk-control/hardware';
import { PROTOCOL_VERSION } from '@desk-control/protocol';
import pino from 'pino';
import { z } from 'zod';

/**
 * The agent binary that runs on a real computer.
 *
 * One cross-platform binary rather than one app per OS: registration,
 * heartbeats, command handling, idempotency and reconnection are identical
 * everywhere. The only platform-specific part is the MonitorControlProvider,
 * which is selected here and implemented in @desk-control/hardware.
 */
const EnvSchema = z.object({
  DESK_CONTROL_URL: z.string().default('ws://127.0.0.1:7420/agent'),
  DESK_CONTROL_PAIRING_TOKEN: z.string().default(''),
  DESK_AGENT_PROVIDER: z
    .enum(['auto', 'mock', 'windows-ddc', 'macos-ddc', 'linux-ddcutil'])
    .default('auto'),
  DESK_AGENT_NAME: z.string().optional(),
  DESK_AGENT_LOG_LEVEL: z.string().default('info'),
});

function detectPlatform(): Platform {
  // A WSL agent controls Windows monitors, so it reports itself as Windows.
  if (isWsl()) return 'windows';

  switch (osPlatform()) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    default:
      return 'unknown';
  }
}

function defaultProviderKind(platform: Platform): PlatformProviderKind {
  // Under WSL the displays belong to Windows, and the DDC bridge reaches them
  // through powershell.exe. Treating this as a Linux host would send us looking
  // for ddcutil on i2c buses that do not exist here.
  if (isWsl()) return 'windows-ddc';

  switch (platform) {
    case 'windows':
      return 'windows-ddc';
    case 'macos':
      return 'macos-ddc';
    case 'linux':
      return 'linux-ddcutil';
    default:
      return 'mock';
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = 'true';
    }
  }
  return result;
}

/**
 * `desk-control-agent probe` - enumerate this machine's monitors and exit.
 *
 * The fastest way to find out whether a machine can actually drive DDC before
 * wiring it into a desk, and the first thing to reach for when a monitor
 * misbehaves. It only reads; it never changes an input.
 */
async function probe(provider: MonitorControlProvider): Promise<void> {
  const monitors = await provider.discoverMonitors();
  if (monitors.length === 0) {
    console.log('No monitors could be reached over DDC/CI.');
    return;
  }

  const observed = await provider.getObservedState();
  const byId = new Map(observed.map((entry) => [entry.stableId, entry]));

  for (const monitor of monitors) {
    const state = byId.get(monitor.stableId);
    console.log(`\n${monitor.detectedName}`);
    console.log(`  stable id    ${monitor.stableId}`);
    console.log(
      `  identity     ${monitor.identity.manufacturerId} ${monitor.identity.model}` +
        `${monitor.identity.serial ? ` \u00b7 serial ${monitor.identity.serial}` : ' \u00b7 no serial'}` +
        `${monitor.identity.weakIdentity ? '  (WEAK - confirm mapping)' : ''}`,
    );
    console.log(`  capabilities ${monitor.capabilities.join(', ') || 'none reported'}`);
    console.log(
      `  inputs       ${monitor.inputs
        .map(
          (input) =>
            `${input.detectedName} (0x${input.ddcInputSourceValue?.toString(16).padStart(2, '0')})` +
            `${input.id === monitor.connectedViaInputId ? '  <- this machine' : ''}`,
        )
        .join('\n               ')}`,
    );
    console.log(
      `  live input   ${
        state?.reachability === 'reachable'
          ? state.activeInputId
          : `unreadable (${state?.error?.message ?? 'unknown'})`
      }`,
    );
  }
  console.log('');
}

async function main(): Promise<void> {
  const env = EnvSchema.parse(process.env);
  const positional = process.argv.slice(2).filter((token) => !token.startsWith('--'));
  const args = parseArgs(process.argv.slice(2));

  const logger = pino({
    level: args.logLevel ?? env.DESK_AGENT_LOG_LEVEL,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
    },
  });

  const platform = detectPlatform();
  const machineId = args.id ?? hostname();
  const requested = (args.provider ?? env.DESK_AGENT_PROVIDER) as PlatformProviderKind | 'auto';
  const providerKind: PlatformProviderKind =
    requested === 'auto' ? defaultProviderKind(platform) : requested;

  let provider: MonitorControlProvider;
  if (providerKind === 'mock') {
    // A standalone agent running the mock provider owns a private simulated
    // desk with no monitors. For a full simulated desk use @desk-control/mock-desk.
    provider = new MockMonitorControlProvider(
      new SimulatedDesk([]),
      buildComputerId({ machineId }),
    );
    logger.warn('Running with the mock provider: this agent controls no real hardware');
  } else {
    try {
      provider = createPlatformProvider(providerKind);
    } catch (error) {
      if (error instanceof PlatformProviderNotImplementedError) {
        logger.error(error.message);
        process.exit(2);
      }
      throw error;
    }
  }

  if (positional[0] === 'probe') {
    await probe(provider);
    await provider.dispose?.();
    return;
  }

  const capabilities: ComputerCapability[] =
    providerKind === 'mock' ? ['report-active-display'] : ['ddc-control', 'report-active-display'];
  const controllerUrl = new URL(args.controller ?? env.DESK_CONTROL_URL);

  const runtime = new AgentRuntime({
    agentId: buildAgentId({ machineId }),
    computerId: buildComputerId({ machineId }),
    detectedName: args.name ?? env.DESK_AGENT_NAME ?? `${hostname()} agent`,
    computerDetectedName: args.name ?? env.DESK_AGENT_NAME ?? hostname(),
    platform,
    agentVersion: '0.1.0',
    capabilities,
    metadata: { providerKind },
    provider,
    discovery: new StaticControllerDiscovery([
      {
        controllerId: 'controller:configured',
        name: 'Desk Controller',
        host: controllerUrl.hostname,
        port: Number(controllerUrl.port || 7420),
        agentUrl: controllerUrl.toString(),
        protocolVersion: PROTOCOL_VERSION,
        discoveredVia: 'static',
      },
    ]),
    createTransport: () => new WebSocketAgentTransport(),
    authToken: env.DESK_CONTROL_PAIRING_TOKEN || null,
    logger: {
      info: (message, context) => logger.info(context ?? {}, message),
      warn: (message, context) => logger.warn(context ?? {}, message),
      error: (message, context) => logger.error(context ?? {}, message),
    },
  });

  await runtime.start();
  logger.info({ providerKind, controller: controllerUrl.toString() }, 'Desk agent started');

  const shutdown = async () => {
    // Fail passive: stopping the agent never changes monitor or switch state.
    await runtime.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
