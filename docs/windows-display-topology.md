# Windows display topology and monitor input routing

## Goal

For a personal Windows desktop connected to an ASUS PA279CV and a company laptop using another input, switching to the laptop should **not** leave a phantom fourth desktop on the Windows PC. The company laptop must not run a Desk Control agent, install software, expose network access, or accept commands.

## What is already implemented

- The Windows agent can discover the PA279CV, identify it from EDID, and switch monitor inputs via DDC/CI VCP 0x60.
- The desk editor can declare an unagented machine and map it to an input.
- The UI and controller coordinate monitor source selection; **they do not currently manage Windows display topology**.

Important: monitor input selection and Windows desktop topology are *independent*. Merely switching VCP 0x60 does not necessarily cause Windows to detach the display. Some monitors retain HPD/EDID on an inactive input.

## Capture evidence from the personal PC

Run in Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\diagnose-windows-display-topology.ps1 -Mode pc -OutDir .\diagnostics
pnpm --filter @desk-control/agent exec tsx src/index.ts probe
```

Switch the PA279CV **using its physical buttons** to the company laptop, then:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\diagnose-windows-display-topology.ps1 -Mode laptop -OutDir .\diagnostics
pnpm --filter @desk-control/agent exec tsx src/index.ts probe
```

These diagnostic commands are read-only. Their WMI/PnP reports indicate monitor enumeration, **not the active Windows desktop layout**. The eventual Windows topology provider must obtain active paths from `QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS)` and map source/target identities to the exact EDID monitor. Do not key topology changes off Windows UI display number ("1") or a guessed enumeration order.

## Proposed implementation

1. Add `DisplayTopologyProvider` as a separate, capability-gated abstraction, not a hidden side effect of `MonitorControlProvider.setInput`. On Windows, use `QueryDisplayConfig` and `SetDisplayConfig` with validated source/target identifiers, never a guessed monitor index.
2. Extend the protocol with explicit `set-display-enabled` and observed active-path reporting; preserve existing idempotency, deadlines, per-agent permissions, and command audit trail.
3. UI: add an **opt-in** `Manage Windows desktop when switching this monitor` setting for each PC-to-monitor wiring. Show the exact machine and EDID identity. Default **off**; settings must be stored in the desk config.
4. Before enabling, require a **two-way DDC return-path test** from the *personal PC* while the PA279CV shows the laptop input. If DDC cannot switch it back, offer a recovery method first (physical monitor button or an external HPD-aware switch). Never describe this as fully automatic without proof.
5. **To laptop:** save/validate the current Windows topology → move desktop windows off the target where possible → disable only the PA279CV target through the Windows topology API → perform DDC input switch. If source switching fails, restore the original topology. Keep other three monitors unchanged.
6. **To PC:** restore the Windows display path **before** attempting the DDC switch where required for DDC accessibility; then command the PA279CV to the PC input and verify. If either step fails, expose an actionable recovery state and do not silently claim success.
7. For monitors that stop accepting DDC on inactive PC inputs, **return switching must fall back to the monitor's physical controls** or hardware switching. An agent running only on the PC cannot guarantee the ability to recover a monitor that rejects commands after switching away.
8. External input changes via the monitor's OSD cannot reliably be inferred on all hardware. Prefer Desk Control initiating the transition. Do not poll and mutate Windows topology based only on an unavailable/ambiguous DDC read.
9. Never disable the last active Windows display, and never perform automatic topology mutation on controller boot, reconnect, shutdown, or heartbeat loss. Protect against stale, overlapping, or replayed commands.

## Acceptance tests

- All four desktop displays on PC mode; top monitor changes to company laptop mode and Windows has exactly three active desktop targets, no phantom desktop area.
- Reversing restores the same identity, arrangement, resolution, and refresh rate; other three displays remain untouched.
- Physical monitor-button switching, DDC timeouts, loss of DDC after switching, agent disconnect, reboots, and controller failure produce truthful UI state and do not strand the PC without usable displays.
- Repeated button presses and retries are idempotent; no automatic switch or topology changes on reconnect.
- No code runs on the company laptop. The controller never routes video or input events.
- Unit tests for topology planner, identity matching, wrong-monitor protection, rollback, and transition state machine; Windows integration tests on real PA279CV before enabling the feature by default.

## Why this is not immediately enabled

Current DDC switching can work while HPD remains asserted, but changing Windows display topology can also remove the very connection through which the PC issues DDC commands. This is a hardware-dependent feature; it must be validated before shipping as a one-tap action.
