# Design system

The UI is built so a new screen looks right by default. Compose the primitives, use the tokens, and
the result matches the rest of the app without any visual decisions being re-made.

Everything lives in `apps/web/src/design/`:

```
design/
  tokens.css              colours, spacing, radii, type, motion, touch targets
  base.css                element defaults, expressed in tokens
  system.css              styles backing the primitives
  desk.css                the one bespoke surface: header, desk map, footer
  primitives/             the components you compose
  index.ts                the only import you need
```

## The two rules

1. **Never hardcode a visual value.** No hex colours, pixel radii, font sizes or durations in
   feature code. If nothing fits, add a token to `tokens.css` first — then it is available
   everywhere and retheming stays a one-file job.
2. **Compose primitives rather than markup.** Reach for `Panel`, `ListRow`, `Tile` before writing a
   `div`. The `ds-*` classes exist to back those components; feature code should not use them
   directly.

## Tokens

Semantic, not literal — `--surface-2`, not `--grey-800`.

| Group     | Tokens                                                                          |
| --------- | ------------------------------------------------------------------------------- |
| Surfaces  | `--surface-page`, `--surface-1..3`, `--surface-inset`                           |
| Borders   | `--border-subtle`, `--border-strong`                                            |
| Text      | `--text-primary`, `--text-secondary`, `--text-tertiary`                         |
| Tones     | `--tone-{accent,ok,busy,warn,bad,idle}` each with `-soft` (fill) and `-border`  |
| Spacing   | `--space-1..9` (4 → 40)                                                         |
| Radii     | `--radius-{sm,md,lg,xl,pill}`                                                   |
| Type      | `--text-2xs..3xl`, `--weight-{regular,medium,bold}`, `--tracking-{label,brand}` |
| Elevation | `--shadow-1`, `--shadow-2`, `--shadow-screen`                                   |
| Motion    | `--duration-{fast,base}`, `--ease-out` — zeroed under `prefers-reduced-motion`  |
| Touch     | `--control-min-height: 44px`                                                    |

`--control-min-height` is a hard requirement, not a suggestion: the primary client is a 5–7"
touchscreen and every interactive element must meet it.

## Tones

One vocabulary for "how is this doing?", shared by `Chip`, `StatusDot`, `ListRow` and the footer:

| Tone     | Meaning                                                                     |
| -------- | --------------------------------------------------------------------------- |
| `ok`     | healthy, live, in sync                                                      |
| `busy`   | work in flight                                                              |
| `warn`   | needs attention but nothing is broken (drifted, unreachable, agent offline) |
| `bad`    | failed                                                                      |
| `idle`   | unknown — we genuinely do not know                                          |
| `accent` | selected, not a health state                                                |

Components take a tone; they never take a colour. The one exception is `StatusDot`'s `color` prop,
for meaning that is not health — connector type is the only current use.

## Primitives

| Component               | Use it for                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppShell`              | Page skeleton: header, left rail, stage, right rail, footer. Rails collapse under the stage on narrow screens.                                                                   |
| `Panel`                 | Any grouped section. `plain` drops the surface but keeps the rhythm.                                                                                                             |
| `SectionLabel`          | Small uppercase heading.                                                                                                                                                         |
| `ListRow`               | Icon + title + subtitle + trailing. Presets, quick actions, source choices and system details are all list rows — that is what keeps unrelated screens feeling like one product. |
| `Tile` / `TileGrid`     | Compact selectable targets in a grid, sized for a finger.                                                                                                                        |
| `Chip`                  | Status pill.                                                                                                                                                                     |
| `StatusDot`             | Small state dot, optionally pulsing.                                                                                                                                             |
| `Button` / `IconButton` | Actions. `IconButton` requires a `label` for screen readers.                                                                                                                     |
| `Sheet`                 | The one modal treatment. Closes on backdrop click and Escape.                                                                                                                    |
| `Notice`                | Inline error banner.                                                                                                                                                             |
| `EmptyState`            | Nothing-here message.                                                                                                                                                            |
| `Stack`                 | Vertical rhythm without a surface.                                                                                                                                               |

## Building a new screen

```tsx
import { AppShell, Panel, ListRow, Chip } from '../design/index.js';

<AppShell
  header={<Header name={snapshot.controller.name} onOpenSystem={open} />}
  left={
    <Panel title="Presets" plain>
      {/* ListRows */}
    </Panel>
  }
  stage={<YourContent />}
  right={<Panel title="Something">{/* ... */}</Panel>}
  footer={<StatusFooter snapshot={snapshot} connection={connection} />}
/>;
```

That gives you the layout, spacing, responsive behaviour and footer treatment for free.

## Icons

`components/icons.tsx`, inline SVG only. No icon font and no CDN sprite: the Pi has no internet in
normal operation, and a dependency that fails exactly when the desk is doing its job is worse than
no icon at all. Every icon takes `size` and inherits `currentColor`.

## Two product rules the UI must keep

**The screen colour on a monitor tile is identity, not content.** A deterministic hue per machine,
with the platform logo as a watermark. It must never look like a screen preview — this system does
not touch the video path and the UI must not imply that it does.

**Observed state is the headline.** A monitor tile shows what is actually on the panel. A pending
request appears as a separate `→ target` line, a stale reading is shown visibly marked as stale, and
nothing is ever optimistically rendered as done. See `MonitorTile`.

## Renaming, everywhere

Every renameable entity follows one shape: a `TextField` whose `placeholder` is the _detected_ name,
whose value is the `customName`, and whose Clear action sets `customName` back to `null`. The
detected name is never overwritten and the entity's identity is never touched — a rename is
presentation only.

Monitors are renamed in Edit desk; computers in the system sheet. Both call the same
`/api/desk/name` endpoint.

## Target viewports

The panel this is built for is **1920 × 440** — a wide, short strip, not a tablet. Half of it again
(**960 × 440**) is the case where it shares the screen with something else.

Height is the scarce resource on both. That inverts the usual responsive instinct: the answer to a
cramped layout here is almost never "stack it", because stacking trades the resource there is least
of. Columns are what make it fit.

Check both after any layout change:

```bash
pnpm dev
```

then open <http://127.0.0.1:5173/viewport-test.html>, which renders the app in iframes at both sizes.

**Do not test by resizing the browser window on Windows.** Chrome clamps a window to a ~500px
minimum width, so a narrow screenshot lays out wider and crops the result — it looks exactly like an
overflow bug that is not there. An iframe has its own layout viewport and reports honestly at any
size, which is why the harness exists.

Component tests run in jsdom, which does no layout, so they cannot catch any of this. Layout
regressions are found by looking — and, when looking is ambiguous, by measuring: the harness is
same-origin, so a throwaway script can read `scrollHeight`, computed `grid-template-columns` and
element widths straight out of the iframe. That is how every fix in this area was actually diagnosed.

### How the layout adapts

| Condition                          | Behaviour                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Default                            | Three columns: presets, desk map, peripherals + quick actions                                                                               |
| ≤ 1240px wide                      | Rails narrow to 240/270 rather than collapsing                                                                                              |
| ≤ 900px wide **and** ≥ 600px tall  | Single column, desk map first                                                                                                               |
| ≤ 560px tall                       | Chrome shrinks to hand height to the map; the shell is fixed to the viewport and rails scroll internally rather than pushing the footer off |
| ≥ 1500px wide **and** ≤ 560px tall | The right rail spreads into two columns, so keyboard routing and quick actions sit side by side                                             |
| ≤ 520px wide                       | Content packs to the top, header wraps, panels tighten                                                                                      |
| ≤ 300px wide                       | Row icons drop, tiles go single-column, the tagline goes                                                                                    |

Monitor tiles degrade by **their own size**, not the window's, via container queries on both axes — a
portrait rail and a landscape panel on one map are wildly different shapes, and a short wide tile
runs out of vertical room long before horizontal. Detail sheds in order of usefulness: physical size,
then the monitor name (its position on the map already implies it), then the connector. What survives
longest is which machine is on the panel, because that is the only reason to look.

### One ordering trap

Short-viewport overrides live at the **end** of `system.css`. They are plain class selectors at the
same specificity as the component rules they adjust, so if they appear earlier in the file the
component rules simply win and the whole block silently does nothing.

## Testing

`src/test/fixtures.ts` builds a valid `DeskSnapshot` so a test states only what it cares about.
Assert on behaviour that a user would notice — that the headline is observed state, that a stale
value is marked, that a status chip appears — not on class names or DOM shape.
