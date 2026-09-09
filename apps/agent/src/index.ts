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
  PlatformProviderNotImplementedError,
  SimulatedDesk,
  MockMonitorControlProvider,
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

async function main(): Promise<void> {
  const env = EnvSchema.parse(process.env);
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

  const capabilities: ComputerCapability[] = ['ddc-control', 'report-active-display'];
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
