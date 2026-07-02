# UI Conventions — Chrome Disciplines

Five rules for all persistent chrome (sidebar, headers, composer, right-panel tools).
The Lineage panel (`apps/desktop/src/features/lineage/`) is the in-repo reference implementation.

## 1. Color is semantics only

Chrome carries zero decorative color. Allowed: status dots (`bg-success`,
running/online), warnings (`warning` tokens, elevated permissions), destructive
(`destructive` tokens), diff +/- colors, unread indicators. Everything else is
grayscale (`foreground` / `muted-foreground` / `secondary`). Target: at most two
semantic color groups visible per screen of chrome. Never hardcode raw palette
classes (`text-blue-500`) or black/white opacities (`border-black/10`) in chrome —
use semantic tokens (`border-border`, `bg-secondary`).

## 2. One text font

`font-mono` only for: code content, diffs, commit SHAs, terminal output, full
filesystem paths in detail views, and keycap (kbd) chips like `⌘P` / `CTRL`.
Any clickable navigation or list-row label (file tree rows, changes rows, git
status file rows) is sans.

## 3. One icon language

lucide-react, `strokeWidth={1.75}`, monochrome in chrome (`text-muted-foreground`
unless conveying status). No colored file-type icon libraries, no hand-rolled
inline `<svg>` where a lucide equivalent exists, no emoji-as-icon.

## 4. One row language

- List rows: `h-7 px-2 text-sm rounded-md`, hover `hover:bg-secondary hover:text-foreground`. Applies to file-tree-style navigation lists; other chrome rows adopt the label/token rules without a mandatory row-height change.
- Section labels: `text-[11px] font-medium text-muted-foreground`, sentence case —
  never `uppercase` + `tracking-*`.
- Muted micro-text uses exactly two opacity steps: `text-muted-foreground` and
  `text-muted-foreground/60`.
- Nested sub-section labels (a group heading inside a panel that already has its own
  header) keep the same size and sentence case but may use `text-foreground` to
  preserve one level of hierarchy below the muted panel header.

## 5. One accent per control row

In any toolbar or control row, at most one element may be solid/colored (the
primary action). All siblings are ghost (see `apps/desktop/src/features/chat/SelectorTrigger.tsx`).
Exceptions that keep their semantic color: elevated-permission warning state,
destructive hover, locked (amber) state.

Worked example: the Git panel Status tab keeps its solid commit button as the
single accent; "Generate" and "stage all" are ghost muted.

## 6. Theme tokens are generated

The color tokens in `apps/desktop/src/styles/index.css` (the four `@generated:tokens`
blocks) are written by `pnpm --filter @zclaudia/desktop run gen:tokens` from
`apps/desktop/scripts/tokens/config.mjs`. Never hand-edit those blocks — edit the
config and regenerate. `gen:tokens:check` verifies the CSS matches the config.

Rules the generator enforces per theme: every neutral sits on the theme's single
hue axis (light 45°, dark 35°, dark-warm 30°, dark-cool 225°); the surface ladder
is `sidebar < background < card (= popover)`; WCAG contrast floors (7:1 body text,
4.5:1 muted text and all solid-fill foreground pairs).
