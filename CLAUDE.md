# CLAUDE.md

Instructions for Claude Code sessions working in this repository.

## What this is

A local-first desk control system. A controller service holds the **desired** state of a desk, agents
on each computer report the **observed** state of hardware they can physically reach, and a
touchscreen/browser UI renders the gap. Monitor input switching happens over DDC/CI from the agents;
peripherals move via a hardware USB switch.

Read `docs/architecture.md` before making structural changes. Read `docs/hardware.md` before touching
anything near providers.

## Invariants — do not violate these

1. **Control plane, never data plane.** No video and no HID data may pass through the controller, the
   Pi, or the network. If a change would put this system between a GPU and a panel, or between a
   mouse and a game, it is wrong regardless of how convenient it is.
2. **Fail passive.** A crashed controller, dead agent, lost network or powered-off Pi must never
   change monitor or peripheral state. Disconnect handling marks things offline and stops there. Never
   add "revert on disconnect", cleanup-on-shutdown, or a heartbeat that releases hardware.
3. **Never fake an observation.** Observed state comes only from an agent reading hardware back.
   Never write observed state optimistically from a command you just sent, in the controller or in the
   UI. If we cannot see the hardware, the honest answer is `unreachable` or `unknown`.
4. **Desired and observed are separate.** Do not merge them into one "current" field. The interesting
   states live in the gap.
5. **No hardcoded hardware.** No monitor models, vendor names, computer names, display counts,
   layouts, input names or presets in core logic. Everything is discovered or configured. The only
   place concrete desk values may appear is `packages/config/src/example-desk.ts` (seed data) and
   tests.
6. **Capabilities gate everything.** Branch on `Monitor.capabilities` / `ComputerCapability`, never on
   a model string or platform. A missing capability is a typed `CAPABILITY_UNSUPPORTED` error, not a
   silent no-op.
7. **Identity is EDID-derived and stable.** Never key a monitor off an OS display index. Custom names
   never replace identity: `displayName = customName ?? detectedName`.
8. **One command path.** Presets, UI clicks and any future hotkey or automation all go through
   `CommandService.setMonitorSource()` / `setPeripheralOwner()`. Never add a second way to change
   hardware.
9. **Validate at every boundary.** Zod-parse anything arriving over a socket, an HTTP body, or from
   disk. Never trust a frame because of where it came from.
10. **Commands are idempotent.** `commandId` is an idempotency key end to end — controller, agent, and
    provider. Re-delivering one must not act twice.
11. **Local-first.** No cloud service, account, telemetry or internet dependency in the normal path.
    LAN only. Never bind beyond localhost by default.
12. **Presets are data.** No preset may acquire behaviour or a special-cased application path.
    Saving one captures OBSERVED state via `captureDeskState()`; anything unreadable is skipped and
    reported, never guessed.

## Commands

```bash
pnpm install
pnpm dev          # controller (7420) + web (5173) + simulated desk (7430)
pnpm --filter @desk-control/agent exec tsx src/index.ts probe   # real monitors on this machine
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Scope with `pnpm --filter @desk-control/<name> <script>`.

Simulator control (dev only):

```bash
curl -XPOST http://127.0.0.1:7430/agents/agent:m4-macbook/stop
curl -XPOST http://127.0.0.1:7430/monitors/<stableId>/fault -H 'content-type: application/json' -d '{"mode":"fail"}'
```

## Layout

```
apps/controller     Fastify service. desk-store, command-service, agent-gateway, snapshot, server
apps/web            React + Vite UI. Renders snapshots; holds no desk state of its own
                    design/ holds the design system - read docs/design-system.md first
apps/agent          Cross-platform agent binary for real machines
apps/mock-desk      Dev simulator: one shared SimulatedDesk + one AgentRuntime per fake computer
packages/domain     Entities, identity, capabilities, desired/observed, reconciliation, presets
packages/protocol   Versioned wire protocol + client API schemas
packages/hardware   MonitorControlProvider, PeripheralSwitchProvider, mocks, platform stubs
packages/discovery  ControllerDiscovery / ControllerAdvertiser (static, in-memory, mDNS-shaped)
packages/config     Config schema, JSON store, example desk seed data
packages/agent-core  Agent runtime: transport, registration, commands, reconnect
packages/test-utils Fixture builders, waitFor
```

## UI work

Read `docs/design-system.md` before touching `apps/web`. Two rules, and they are not negotiable:

- **Never hardcode a visual value** - no hex colours, pixel radii, font sizes or durations in
  feature code. Add a token to `apps/web/src/design/tokens.css` if nothing fits.
- **Compose primitives** (`Panel`, `ListRow`, `Tile`, `Chip`, `StatusDot`, `Sheet`, `Slider`,
  `TextField`, `AppShell`) from `design/index.js` rather than writing markup. The `ds-*` classes back those components; feature
  code should not use them directly.

Also specific to this product:

- A monitor tile's coloured screen is an _identity_ treatment for the source machine - a
  deterministic hue plus a platform watermark. It must never read as a screen preview: this system
  does not touch the video path and the UI may not imply otherwise.
- Every interactive element meets `--control-min-height` (44px). The primary client is a 5-7"
  touchscreen.
- Controls for things that do not exist yet are rendered disabled with the reason attached, never
  hidden and never wired to a no-op. `QuickActions` is the worked example.
- An agent whose `providerKind` is `mock` is badged **Simulated** in the UI. Mock hardware sitting
  beside real hardware is otherwise impossible to tell apart, which is exactly how a simulated desk
  gets mistaken for a real one.

## Conventions

- **Internal packages are source-only.** `packages/*` export `./src/index.ts`; there is no build step
  for them. Apps bundle them (tsup / Vite). Do not add `dist` outputs to these packages.
- **Relative imports carry `.js` extensions**, ESM style, even for `.ts` files.
- **Zod schemas are the source of truth**; derive types with `z.infer`. Do not hand-write a duplicate
  interface.
- Prefer simple explicit code over clever abstraction. This codebase is small on purpose.
- Comments explain _why_, especially where a hardware reality forces an odd shape (see
  `selectControlPath`, `lastKnownActiveInputs`, `MockMonitorControlProvider.getObservedState`).

## Adding a command kind

Adding a member to `CommandPayload` would break older agents, whose parser rejects the whole frame.
So the agent declares `supportedCommandKinds` in `agent.hello` (optional, defaulting to
`['set-monitor-input']`), derived from what its provider actually implements, and the controller
checks that list when selecting a control path. No protocol bump; unsupported work is refused
immediately with `NO_CONTROL_PATH` rather than dispatched and timed out.

Give a new kind its own `commandTargetKey` unless it genuinely shares a target - brightness must not
supersede an in-flight input switch on the same monitor.

## Things that are easy to get wrong here

- **Power states differ per panel.** VCP 0xD6 values are not universal: one monitor on this desk
  offers standby, the one beside it does not. Take a named state and resolve it against the values
  that monitor advertises; refuse when there is no match.
- **DDC only answers on the live input.** After a switch, the agent that _gave up_ the input loses
  access and the one that _gained_ it has not polled yet. `DeskStore.lastKnownActiveInputs` is a
  routing hint for this window only — never surface it as current truth. `lastKnownSourceComputerId`
  in the snapshot is explicitly rendered as stale.
- **One monitor, several control paths.** Merge agent reports by stable id; union their capabilities;
  route commands via `selectControlPath()`.
- **A single-channel USB switch moves every peripheral at once.** `setPeripheralOwner` updates every
  peripheral on that channel and collapses onto one command.
- **Wiring is discovered** from `connectedViaInputId`. `wiringOverrides` in config is only for inputs
  no agent can report.
- Hardware facts are **never persisted**. Config holds user intent and labels only, and it is
  written as it changes (debounced), not on shutdown - a Pi loses power without warning.
- A computer does not need an agent to be routable. `manualComputers` plus `wiringOverrides` let the
  user declare a console or an un-instrumented laptop, and the switch is carried out by whichever
  agent holds DDC access to that monitor.
- Desired state is saved on shutdown but **never re-applied on boot**.

## Current state

Everything works end to end against simulated hardware, and **the Windows DDC/CI provider is real and
verified against physical monitors** — discovery, EDID identity, capability parsing, input switching
with read-back verification.

macOS and Linux providers are still stubs that throw. Real USB switch control is still simulated.
mDNS is interface-only; static discovery is in use. Authentication is an optional shared token; the
pairing design is in `docs/protocol.md`.

Next milestone: macOS DDC, so two agents see the same panel and control-path merging is exercised for
real. Scope is at the end of `docs/hardware.md`.

### Working on the Windows provider

It lives in `packages/hardware/src/platform/windows/`. The DDC calls go through a long-lived
`powershell.exe` process speaking one JSON object per line — no native module, and it works from WSL
as well as native Windows, which is how it is tested.

- `ddc-bridge-script.ts` holds the PowerShell source as a `String.raw` template. Do not use backticks
  or `${` in it.
- `capabilities.ts` parses the MCCS capabilities string. Two real strings are in its tests; add
  captured strings rather than invented ones when fixing a parsing bug.
- Never trust the `type` or `max` fields from a VCP read — real panels disagree about both. The
  capabilities string is the only authority on which inputs exist.
- Every write is confirmed by reading the panel back. Losing DDC after a write counts as success
  (the panel was handed to another machine); a read that keeps showing another input is a failure.

`pnpm --filter @desk-control/agent exec tsx src/index.ts probe` enumerates the real monitors on the
current machine without changing anything.

## Out of scope for now

Cloud, accounts, remote access, audio switching, power management, Pi GPIO, production installers,
polished animations.
