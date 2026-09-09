import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Runtime configuration.
 *
 * Note the default host: 127.0.0.1. The controller is never exposed beyond the
 * local machine unless the operator opts in, and opting in prints a warning
 * telling them to set a pairing token.
 */
const EnvSchema = z.object({
  DESK_CONTROL_HOST: z.string().default('127.0.0.1'),
  /** 0 asks the OS for an ephemeral port; used by tests. */
  DESK_CONTROL_PORT: z.coerce.number().int().nonnegative().default(7420),
  DESK_CONTROL_DATA_DIR: z.string().default('.data'),
  DESK_CONTROL_LOG_LEVEL: z.string().default('info'),
  /** Shared secret agents must present. Empty means "accept any LAN agent". */
  DESK_CONTROL_PAIRING_TOKEN: z.string().default(''),
  DESK_CONTROL_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(12_000),
  DESK_CONTROL_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  DESK_CONTROL_OBSERVE_INTERVAL_MS: z.coerce.number().int().positive().default(3_000),
  /** An agent is considered offline after this long without a frame. */
  DESK_CONTROL_AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /** Optional path to a built web bundle to serve from the controller. */
  DESK_CONTROL_WEB_DIR: z.string().optional(),
});

export interface ControllerConfig {
  host: string;
  port: number;
  dataDir: string;
  configPath: string;
  logLevel: string;
  pairingToken: string | null;
  commandTimeoutMs: number;
  heartbeatIntervalMs: number;
  observeIntervalMs: number;
  agentTimeoutMs: number;
  webDir: string | null;
}

export function loadControllerConfig(env: NodeJS.ProcessEnv = process.env): ControllerConfig {
  const parsed = EnvSchema.parse(env);
  const dataDir = resolve(process.cwd(), parsed.DESK_CONTROL_DATA_DIR);
  return {
    host: parsed.DESK_CONTROL_HOST,
    port: parsed.DESK_CONTROL_PORT,
    dataDir,
    configPath: resolve(dataDir, 'desk-config.json'),
    logLevel: parsed.DESK_CONTROL_LOG_LEVEL,
    pairingToken: parsed.DESK_CONTROL_PAIRING_TOKEN || null,
    commandTimeoutMs: parsed.DESK_CONTROL_COMMAND_TIMEOUT_MS,
    heartbeatIntervalMs: parsed.DESK_CONTROL_HEARTBEAT_INTERVAL_MS,
    observeIntervalMs: parsed.DESK_CONTROL_OBSERVE_INTERVAL_MS,
    agentTimeoutMs: parsed.DESK_CONTROL_AGENT_TIMEOUT_MS,
    webDir: parsed.DESK_CONTROL_WEB_DIR ? resolve(parsed.DESK_CONTROL_WEB_DIR) : null,
  };
}
