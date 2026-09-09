# Development

## Setup

```bash
pnpm install
```

Node 20.10+ and pnpm 10. Nothing else — no database, no native modules, no network access after
install.

## Running

```bash
pnpm dev
```

Turborepo starts three processes in parallel, with prefixed logs:

| Process                    | Where                   | What                                               |
| -------------------------- | ----------------------- | -------------------------------------------------- |
| `@desk-control/controller` | <http://127.0.0.1:7420> | The service                                        |
| `@desk-control/web`        | <http://localhost:5173> | Vite dev server, proxying `/api` to the controller |
| `@desk-control/mock-desk`  | <http://127.0.0.1:7430> | Simulated desk + four agents + control API         |

Open <http://localhost:5173>.

The web dev server proxies `/api` (HTTP and WebSocket) to the controller, so the UI talks to one
origin in development and in production, where the controller can serve the built bundle itself.

## Trying the vertical slice

1. Four monitors appear, all showing **Gaming PC**.
2. Click **Top**. The sheet lists only computers actually cabled to that panel, with the connector and
   the best mode each path supports.
3. Pick **M4 MacBook**. The tile goes `Switching`, keeps showing the previous source dimmed, and
   displays `→ M4 MacBook`.
4. After the simulated panel delay the tile shows **M4 MacBook** and `Live`.
5. Apply the **Work** preset and watch several panels transition together.
6. Stop an agent (below) and watch the computer go offline while the desk stays exactly as it is.

## Simulator control API

The mock desk exposes a small API so failure paths can be exercised without unplugging anything.

```bash
curl -s http://127.0.0.1:7430/agents
```

```bash
curl -XPOST http://127.0.0.1:7430/agents/agent:m4-macbook/stop
```

```bash
curl -XPOST http://127.0.0.1:7430/agents/agent:m4-macbook/start
```

```bash
curl -s http://127.0.0.1:7430/monitors
```

Inject a hardware fault (`fail`, `unreachable`, or `timeout`):

```bash
curl -XPOST http://127.0.0.1:7430/monitors/monitor:aus:xg27aqm:asus-xg27-0001/fault -H 'content-type: application/json' -d '{"mode":"fail","code":"DEVICE_BUSY","message":"panel refused"}'
```

Clear it:

```bash
curl -XDELETE http://127.0.0.1:7430/monitors/monitor:aus:xg27aqm:asus-xg27-0001/fault
```

## Scripts

| Command                             | Notes                                                  |
| ----------------------------------- | ------------------------------------------------------ |
| `pnpm dev`                          | Controller + web + simulator                           |
| `pnpm build`                        | tsup bundles for the Node apps, Vite build for the web |
| `pnpm test`                         | Vitest across every package                            |
| `pnpm lint`                         | ESLint 9 flat config                                   |
| `pnpm typecheck`                    | `tsc --noEmit` per package                             |
| `pnpm format` / `pnpm format:check` | Prettier                                               |

Any of these can be scoped: `pnpm --filter @desk-control/controller test`.

## Configuration

Controller environment variables (all optional):

| Variable                             | Default     | Notes                                                  |
| ------------------------------------ | ----------- | ------------------------------------------------------ |
| `DESK_CONTROL_HOST`                  | `127.0.0.1` | Set to `0.0.0.0` for LAN use — set a pairing token too |
| `DESK_CONTROL_PORT`                  | `7420`      | `0` picks an ephemeral port (tests)                    |
| `DESK_CONTROL_DATA_DIR`              | `.data`     | Where `desk-config.json` lives                         |
| `DESK_CONTROL_PAIRING_TOKEN`         | _(unset)_   | Shared secret agents must present                      |
| `DESK_CONTROL_COMMAND_TIMEOUT_MS`    | `12000`     |                                                        |
| `DESK_CONTROL_HEARTBEAT_INTERVAL_MS` | `5000`      |                                                        |
| `DESK_CONTROL_OBSERVE_INTERVAL_MS`   | `3000`      |                                                        |
| `DESK_CONTROL_AGENT_TIMEOUT_MS`      | `15000`     | Half-open socket detection                             |
| `DESK_CONTROL_WEB_DIR`               | _(unset)_   | Serve a built UI from the controller                   |

Agent: `DESK_CONTROL_URL`, `DESK_CONTROL_PAIRING_TOKEN`, `DESK_AGENT_PROVIDER`, `DESK_AGENT_NAME` —
each also available as a CLI flag (`--controller`, `--provider`, `--name`, `--id`).

On first run the controller writes `.data/desk-config.json` seeded from the example desk. Edit it by
hand; it is plain JSON and is validated on load. An invalid file is moved aside rather than deleted,
and the controller falls back to defaults.

## Editing the desk

Everything the desk needs is editable from the UI - press **Edit desk**:

- drag a display to arrange it (snaps to half a grid unit)
- tap a display to rename it, or to say what is plugged into each of its inputs
- add a machine that has no agent, and wire it to an input

Edits are written to `desk-config.json` as you make them. The equivalent API calls, if you prefer
curl:

```bash
curl -XPOST http://127.0.0.1:7420/api/desk/computers -H 'content-type: application/json' -d '{"detectedName":"PlayStation 5","platform":"unknown"}'
```

```bash
curl -XPOST http://127.0.0.1:7420/api/desk/wiring -H 'content-type: application/json' -d '{"monitorId":"<id>","inputId":"input-0x11","computerId":"computer:manual:playstation-5"}'
```

## UI work

`apps/web` is built on a small design system in `apps/web/src/design`. Read
[design-system.md](design-system.md) before adding a screen: compose the primitives and use the
tokens, and a new page matches the rest of the app without any visual decisions being re-made.

Note that the dev controller writes its config to `apps/controller/.data`, not the repository root,
because Turborepo runs each script in its own package directory. Delete that directory to re-seed
the example desk.

## Monorepo conventions

**Internal packages are source-only.** `packages/*` expose `./src/index.ts` directly and have no
build step. `tsx`, Vite, Vitest and `tsc` all consume TypeScript directly, and the app bundlers
(`tsup`, Vite) inline them. This removes an entire build-ordering problem; the trade-off is that these
packages are not independently publishable, which they are not meant to be.

**Imports use `.js` extensions** on relative paths (ESM convention) even though the files are `.ts`.

**Zod schemas are the source of truth.** Types are inferred with `z.infer`. Do not hand-write a type
that duplicates a schema.

## Testing

- `packages/domain` — reconciliation, identity, capabilities, preset planning (pure, fast)
- `packages/protocol` — versioning and boundary validation, including messages that must be rejected
- `packages/hardware` — simulated panel behaviour, idempotency, DDC active-input reachability
- `packages/agent-core` — the agent runtime against an in-memory transport
- `packages/discovery` — advertise → discover lifecycle
- `apps/controller/test` — the full vertical slice: real Fastify, real WebSockets, real protocol
  frames, real agent runtimes over a simulated desk
- `apps/web` — that the UI renders observed state and never optimistically shows a request

The controller harness (`apps/controller/test/harness.ts`) is the fastest way to write a new
end-to-end test. Nothing in the command path is stubbed.

Prefer `waitFor` from `@desk-control/test-utils` over sleeps, and assert on observed hardware rather
than on command status where both are available.

## Running an agent on a real machine

First, check the machine can actually drive DDC. `probe` only reads; it never changes an input:

```bash
pnpm --filter @desk-control/agent exec tsx src/index.ts probe
```

Then point it at a controller:

```bash
pnpm --filter @desk-control/agent exec tsx src/index.ts --controller ws://192.168.1.10:7420/agent
```

The provider is chosen automatically: `windows-ddc` on Windows **and under WSL** (where the displays
belong to Windows and the bridge reaches them through `powershell.exe`). Override with `--provider`.
macOS and Linux still exit with a clear message — those providers are stubs.

Real monitors are auto-placed in a row on the desk map, marked `autoPlaced`, ready to be arranged.

### First-run config

The controller seeds an **empty** desk by default — no invented monitors, no fictional presets. The
dev environment passes `--seed example` to get the simulated four-monitor desk instead. Use a
separate data directory to keep a real desk apart from the simulated one:

```bash
DESK_CONTROL_DATA_DIR=.data-real pnpm --filter @desk-control/controller exec tsx src/index.ts
```

## Raspberry Pi notes

The controller is deliberately dependency-light and free of native modules, so ARM64 needs no special
handling. For a single-process deployment, build the web UI and point the controller at it:

```bash
DESK_CONTROL_WEB_DIR=apps/web/dist node apps/controller/dist/index.js
```

Packaging, a service unit, and kiosk-mode browser setup are not part of this bootstrap.
