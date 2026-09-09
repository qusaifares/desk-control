# Contributing

## Getting set up

```bash
pnpm install
pnpm dev
```

Node 20.10+, pnpm 10. See [docs/development.md](docs/development.md) for the full environment,
including the simulator's control API for stopping agents and injecting hardware faults.

## Before opening a change

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four must pass. `pnpm format` before committing.

## The rules that matter

These come from the system's design, not from taste. A change that breaks one of them will be sent
back regardless of how well it is written.

1. **The controller is a control plane.** No video, no HID data, ever. Not through the Pi, not over
   the network.
2. **Fail passive.** Nothing may change hardware state as a consequence of a crash, disconnect or
   shutdown.
3. **Never fake an observation.** Observed state comes only from reading hardware back.
4. **No hardcoded hardware** in core logic — no models, vendors, counts, layouts or presets.
5. **Capabilities gate behaviour**, not model strings or platforms.
6. **One command path.** Presets and clicks alike go through `CommandService`.
7. **Validate at every boundary** with Zod.

`CLAUDE.md` has the complete list with rationale.

## Where things go

| Change                                      | Package                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| New entity, capability, or state rule       | `packages/domain`                                                             |
| New message or API shape                    | `packages/protocol` (bump `PROTOCOL_VERSION` if meaning changes)              |
| New hardware backend                        | `packages/hardware` — implement the provider interface, nothing above changes |
| Discovery mechanism (mDNS)                  | `packages/discovery`                                                          |
| Persisted user config                       | `packages/config`                                                             |
| Orchestration, lifecycle, routing decisions | `apps/controller`                                                             |
| Anything visual                             | `apps/web` — it renders snapshots and holds no desk state                     |

If a change requires touching core logic to support one specific piece of hardware, the abstraction is
wrong. Fix the abstraction.

## Adding a monitor control provider

1. Implement `MonitorControlProvider` in `packages/hardware/src/platform/`.
2. Produce the **same** `stableId` as every other provider for the same panel — EDID
   `manufacturerId + model + serial`. Cross-agent merging depends on it.
3. `getObservedState()` must read hardware. Never echo a value you just wrote.
4. `setInput()` must be idempotent on `commandId`.
5. Report unreachable as a result, not an exception.
6. Wire it into `createPlatformProvider()`.

Test it against the same expectations `MockMonitorControlProvider` satisfies.

## Tests

Write tests that would fail if the behaviour regressed in a way a user would notice. Concretely:
state transitions, protocol rejection, command lifecycle, capability gating, fail-passive behaviour.

Do not add tests that only assert a schema parses its own output, or that a getter returns what a
setter set.

For anything spanning components, use `apps/controller/test/harness.ts` — it runs a real controller
and real agents over a simulated desk, with nothing in the command path stubbed.

## Commits

Present tense, explain why when the what is not obvious. Keep unrelated changes apart.
