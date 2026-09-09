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

## Testing

`src/test/fixtures.ts` builds a valid `DeskSnapshot` so a test states only what it cares about.
Assert on behaviour that a user would notice — that the headline is observed state, that a stale
value is marked, that a status chip appears — not on class names or DOM shape.
