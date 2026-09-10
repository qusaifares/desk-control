# Desk Control

A local-first control system for a desk with several computers, several monitors, and shared
peripherals.

A touchscreen panel (eventually a Raspberry Pi with a 5–7" display, today any browser) shows your
physical monitor layout and lets you route computers to monitors, move the keyboard and mouse
between machines, and apply presets.

**The controller is a control plane, never a data plane.** Video stays on
`GPU → DisplayPort → monitor`. Keyboard and mouse stay on their native connection or a hardware USB
switch. Nothing in this system sits between your GPU and your panel, or between your mouse and your
game. See [docs/hardware.md](docs/hardware.md) for why that constraint shapes everything else.

---

## Status

This is a working **architectural bootstrap with a complete vertical slice**, not a finished
product. Everything below the UI is real — real HTTP, real WebSockets, a real versioned protocol, a
real command lifecycle — but the hardware underneath is simulated.

| Area                                                                   | State                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------- |
| Domain model, identity, capabilities                                   | Implemented                                             |
| Desired vs observed state, reconciliation                              | Implemented                                             |
| Versioned agent protocol with runtime validation                       | Implemented                                             |
| Controller: registry, command lifecycle, timeouts, supersession        | Implemented                                             |
| Agent runtime: registration, heartbeat, idempotent commands, reconnect | Implemented                                             |
| Presets as data, applied through the normal command path               | Implemented                                             |
| Web UI: desk map, source picker, presets, peripherals, connectivity    | Implemented (minimal design)                            |
| Monitor control provider abstraction                                   | Implemented                                             |
| Mock provider + shared simulated desk                                  | Implemented                                             |
| **Windows DDC/CI, macOS DDC, Linux ddcutil**                           | **Not implemented — stubs that throw**                  |
| Real USB switch / GPIO control                                         | Not implemented — simulated                             |
| mDNS discovery                                                         | Interface defined, static discovery in use              |
| Pairing / authentication                                               | Optional shared token; full pairing designed, not built |
| Audio, power management, Pi packaging                                  | Not started                                             |

## Architecture at a glance

```
    Touchscreen / browser / phone
                 |  HTTP + WebSocket (snapshots)
        Controller service  ──────────────  desk-config.json
                 |  versioned agent protocol over LAN WebSocket
   ┌─────────────┼─────────────┬─────────────┐
Windows        macOS         macOS        Windows
 agent         agent         agent         agent
   |             |             |             |
DDC/CI        DDC/CI        (source)      DDC/CI
   └─────────────┴──── monitors ───────────┘
```

Agents run on the computers, discover the monitors they are cabled to, and expose capabilities. The
controller never needs a video or USB connection to anything. Full diagrams:
[docs/architecture.md](docs/architecture.md).

## Prerequisites

- Node.js 20.10 or newer
- pnpm 10 (`corepack enable && corepack prepare pnpm@10 --activate`)

No database, no cloud account, no internet connection.

## Run it

```bash
pnpm install
```

```bash
pnpm dev
```

That starts three things in parallel:

- **controller** on <http://127.0.0.1:7420>
- **web UI** on <http://localhost:5173>
- **mock desk** — a simulated four-monitor, four-computer desk with four agents, plus a control API
  on <http://127.0.0.1:7430>

Open <http://localhost:5173>. You should see four monitors arranged like the example desk, all
showing the gaming PC. Click one, pick another computer, and watch it go `Switching → Live`.

Stop an agent to see fail-passive behaviour:

```bash
curl -XPOST http://127.0.0.1:7430/agents/agent:m4-macbook/stop
```

The computer is marked offline; every monitor keeps showing exactly what it was showing.

## Scripts

| Command          | What it does                                        |
| ---------------- | --------------------------------------------------- |
| `pnpm dev`       | Controller, web UI and simulated desk together      |
| `pnpm build`     | Bundles the controller, agent, mock desk and web UI |
| `pnpm test`      | Full test suite                                     |
| `pnpm lint`      | ESLint across the workspace                         |
| `pnpm typecheck` | `tsc --noEmit` across the workspace                 |
| `pnpm format`    | Prettier write                                      |

## Repository layout

```
apps/
  controller/    Fastify service: agent registry, desired state, command lifecycle
  web/           React + Vite touchscreen/browser UI
  agent/         Cross-platform agent binary for real machines
  mock-desk/     Dev-only simulator: one shared simulated desk + N agents
packages/
  domain/        Entities, identity, capabilities, desired vs observed, reconciliation
  protocol/      Versioned wire protocol and client API schemas (Zod)
  hardware/      MonitorControlProvider / PeripheralSwitchProvider + mocks + platform stubs
  discovery/     Controller discovery + advertisement interfaces (static, in-memory, mDNS-shaped)
  config/        Persisted user config, JSON store, example desk seed data
  agent-core/    Reusable agent runtime (transport, registration, commands, reconnect)
  test-utils/    Fixture builders and async helpers
docs/
```

## Documentation

- [docs/architecture.md](docs/architecture.md) — components, data flow, diagrams, decisions
- [docs/domain-model.md](docs/domain-model.md) — entities, identity, desired vs observed
- [docs/protocol.md](docs/protocol.md) — wire protocol, versioning, errors, security roadmap
- [docs/hardware.md](docs/hardware.md) — control plane vs data plane, DDC/CI realities
- [docs/development.md](docs/development.md) — environment, workflows, simulator control API
- [docs/raspberry-pi.md](docs/raspberry-pi.md) — running the panel on a Pi: install, kiosk, display
- [docs/design-system.md](docs/design-system.md) — tokens, primitives, and how to build a new screen
- [docs/usb-switch-wiring.md](docs/usb-switch-wiring.md) — wiring a KM switch to the Pi's GPIO
- [docs/glossary.md](docs/glossary.md) — DDC, VCP, EDID, GPIO and the rest, in plain terms
- [CLAUDE.md](CLAUDE.md) — invariants and conventions for future work in this repo

## Real hardware

Both DDC providers are the _same_ code over a different transport: a Windows helper over
`dxva2.dll`, a macOS helper over IOAVService I2C. Identity, capability parsing, wiring inference and
switch verification are shared, so a panel gets the same EDID-derived id whichever machine sees it —
which is what lets the controller merge two agents into one monitor with two control paths.

The Windows path has been verified end to end against physical monitors, including a live input
switch. **The macOS path has not been run on a Mac yet** — see [docs/hardware.md](docs/hardware.md)
for exactly what to expect when you first try it.

On a Windows machine (or WSL on one — the DDC bridge reaches the displays either way):

```bash
pnpm --filter @desk-control/agent exec tsx src/index.ts probe
```

```
AUS PA278CV
  stable id    monitor:aus:pa278cv:n6lmqs137321
  identity     AUS PA278CV · serial N6LMQS137321
  capabilities brightness, contrast, input-switch, power, read-active-input, volume
  inputs       HDMI 1 (0x11)
               DisplayPort 1 (0x0f)  <- this machine
               DisplayPort 2 (0x10)
  live input   input-0x0f
```

Point an agent at a controller and its real monitors appear on the desk map, auto-placed and ready
to arrange:

```bash
pnpm --filter @desk-control/agent exec tsx src/index.ts --controller ws://127.0.0.1:7420/agent
```

On a Mac, the same command builds a small helper with `clang` (Xcode Command Line Tools) and probes
over IOAVService.

## Machines without an agent

A source does not need to run anything to be useful. Discovery can only report inputs an agent
actually sits on, so on a desk where one machine runs an agent every other input looks empty — and
nothing can be routed to it.

**Edit desk** fixes that: declare the machine, say which input it is plugged into, and it becomes a
routable source. The switch is carried out by whichever agent holds DDC access to that monitor, so
the declared machine is never involved. A games console works exactly as well as a laptop.

Everything you set there — display names, desk arrangement, wiring — is written to
`desk-config.json` as you make it, not on shutdown.

## Next milestone

Verify the macOS provider on a real MacBook, then wire that Mac to a monitor the Windows PC also
sees — the first time two agents share a panel and control-path merging stops being theory. Details
at the end of [docs/hardware.md](docs/hardware.md).

Until that hardware exists, the biggest remaining gap is real peripheral-switch control — keyboard
and mouse routing is still entirely simulated.
