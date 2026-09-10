/**
 * Config migrations.
 *
 * Runs on the raw JSON *before* validation, because an older config by
 * definition does not satisfy the current schema. Each step is a pure function
 * from one shape to the next, so they compose and can be tested in isolation.
 *
 * A config that cannot be migrated is left alone; the store quarantines it
 * rather than deleting a user's desk.
 */
export const CURRENT_CONFIG_VERSION = 2;

interface VersionedConfig {
  configVersion?: unknown;
  [key: string]: unknown;
}

/**
 * v1 -> v2: four parallel `customNames` maps collapse into one `overrides`
 * record keyed by entity id, so a new override field no longer needs a new
 * top-level structure.
 */
function migrateV1ToV2(config: VersionedConfig): VersionedConfig {
  const customNames = (config.customNames ?? {}) as Record<string, Record<string, string>>;
  const overrides: Record<string, { customName: string; icon: null; colorway: null }> = {};

  for (const bucket of ['computers', 'monitors', 'monitorInputs', 'peripherals'] as const) {
    for (const [entityId, customName] of Object.entries(customNames[bucket] ?? {})) {
      if (typeof customName !== 'string' || customName.length === 0) continue;
      overrides[entityId] = { customName, icon: null, colorway: null };
    }
  }

  const { customNames: _dropped, ...rest } = config;
  return { ...rest, configVersion: 2, overrides };
}

const STEPS: Record<number, (config: VersionedConfig) => VersionedConfig> = {
  1: migrateV1ToV2,
};

export interface MigrationResult {
  config: unknown;
  /** Versions actually applied, for logging. Empty when already current. */
  applied: number[];
}

export function migrateDeskConfig(raw: unknown): MigrationResult {
  if (typeof raw !== 'object' || raw === null) return { config: raw, applied: [] };

  let config = raw as VersionedConfig;
  const applied: number[] = [];

  // A config with no version predates versioning; treat it as v1.
  let version = typeof config.configVersion === 'number' ? config.configVersion : 1;

  while (version < CURRENT_CONFIG_VERSION) {
    const step = STEPS[version];
    if (!step) break;
    config = step(config);
    applied.push(version);
    version += 1;
  }

  return { config, applied };
}
