# Mobile walkthrough — Agents profile editors (2026-08-07)

Measured at 375×812 against a real gateway-direct stack (gateway 3200 → server 3100 →
vite 1430), Android Chrome UA. All numbers below are live `getBoundingClientRect` /
`scrollWidth` readings from the running app, not estimates.

Scope: `ProfileEditor` (agent profiles), `LlmProfileEditor`, `McpServerEditor`,
`SkillEditor` — all four share `ui/ProfileHeader.tsx` and `ui/EditorSection.tsx`.

**Status: all fixed.** P0 in `19ccb254`, P1 + P2 in `3a46582c`. Re-measured
figures are noted per item below.

---

## P0 — controls pushed off-screen and unreachable

### 1. `ProfileHeader` badge cluster never wraps

`ui/ProfileHeader.tsx:75` — the cluster is `flex-wrap` **and** `flex-shrink-0`.
Those contradict: `flex-shrink-0` makes the cluster size to its max-content width,
so its single flex line is always wide enough and wrapping never triggers. The
cluster then overflows the viewport and is clipped (`document.scrollWidth` stays
375, so it cannot even be scrolled to).

Measured on the LLM provider editor:

| element | x-range | on screen? |
| --- | --- | --- |
| `Dev MacBook` | 24 → 112 | yes |
| `Default` | 120 → 174 | yes |
| `OpenAI Codex (ChatGPT Plus/Pro)` | 182 → 378 | clipped |
| `No credential` | 386 → 472 | **no** |
| `Saved` | 480 → 528 | **no** |
| `⋯` actions menu | 536 → 564 | **no** |

Header `scrollWidth` 570 vs `clientWidth` 375. So on a phone the provider's
"No credential" warning, the save state, and the delete / set-default menu are all
invisible and untappable.

The agent profile editor hits the same wall once the `Saved` chip appears
(`scrollWidth` 401 vs 375, `⋯` at 376 → 387).

**Fixed** in `19ccb254`: dropping `flex-shrink-0` reflows to three lines,
`scrollWidth` back to 375, every badge inside 0 → 359, header height 83 → 139px.
The `⋯` menu opens and lists "Set as default provider" / "Delete provider".
Desktop still fits on one line (`scrollWidth === clientWidth`, height unchanged).

> Note: this is the same defect logged as Q3 in `docs/mobile-ui-findings.md` and
> marked fixed in `ff22ada2`. Adding `flex-wrap` there moved the overflow from the
> first line to the second; it did not remove it. Q3 should be reopened.

---

## P1 — usable but hostile

### 2. Tool-set names truncated past recognition

`ProfileEditor.tsx:1043` puts the group name, a `shrink-0` "N tools" pill, and a
tool preview on one flex line. The name is the only element allowed to shrink, so
it loses every time:

| group | width given | width needed | rendered as |
| --- | --- | --- | --- |
| Core Coding | 39px | 82px | `Cor…` |
| Interaction | 32px | 71px | `Int…` |
| Web | 20px | 29px | `W..` |
| MCP Control | 21px | 84px | `M..` |
| Tasks | 14px | 37px | `T..` |
| Code Intelligence | 35px | 115px | `Co...` |

The one thing that identifies the row gets 25–30% of the space it needs.

**Fixed**: the name owns the first line; count and preview moved to a second line
below `md`. Re-measured, every set name renders in full (rendered width equals
scroll width for all six, e.g. Code Intelligence 140/140). Also adds the expand
chevron the row never had (P2 item 7).

### 3. Checkboxes are 13×13px

`enable full tool set *` renders as a bare native checkbox at 13×13 — the primary
control of the Capabilities tab, at under a third of the 44px touch target. The
three Skills source checkboxes are the same. `customize tool set *` is 73×30.

**Fixed**: new shared `components/ui/Checkbox` wraps the input in a padded label —
verified 40×40 hit area with a 16px box, and a synthetic tap 3px from the corner
(outside the box) toggles it. Skill source rows and the Customize button get
taller touch rows.

The header `⋯` measured 28×28 as a border box but `IconButton` already carries
`before:-inset-1.5` below `md`, so its real target is 40px. Left alone.

### 4. Model tab burns a full screen on five fields

`EditorRow` stacks label above control unconditionally below `md`, costing:

| row | height |
| --- | --- |
| Description | 121px |
| Agent Type | 95px |
| LLM Profile | 113px |
| Model | 125px |
| Thinking Level | 95px |

549px of rows for five controls — a bare "label + dropdown" row costs 95px.

**Fixed**: `EditorRow` defaults to `layout="inline"` (side by side at every width);
rows that need the width opt into `layout="stack"`. Re-measured: 95/113/125/95 →
63px each, and the Model tab plus the Multimodal fallback section now fit on one
screen. Selector popovers anchor right with a min-width so the narrower trigger
does not narrow the menu.

### 5. Prompt tab wastes the screen in both states

Collapsed: the whole tab is one truncated preview line plus `Edit`. Expanded: a
`rows={9}` / `min-h-[180px]` textarea with roughly 600px of dead space beneath it.
**Fixed**: starts expanded on mobile, and the textarea grows to `55vh`
(`md:min-h-[180px]` keeps desktop as it was).

### 6. Three nested cards

Capabilities → Providers renders `EditorSection` → inner card → empty-state card,
each with its own padding and border. About 48px of the 375px width is chrome
before any content. **Fixed**: the inner card drops its border, background, and padding below `md`.

---

## P2

7. ~~Tool-set rows expand by tapping the name, with no chevron or other
   affordance.~~ Fixed alongside item 2.
8. `Agents` mode category switching (Agent Profiles / LLM Providers / Skills /
   MCP Servers) is only reachable through the drawer — workable, but every switch
   costs a drawer round-trip. Left as is; the drawer is the app's standard
   navigation surface on mobile.

---

## Checked and fine

- `NewAgentProfileModal` is correctly full-screen on mobile with a pinned footer.
- `EditorTabs` (Model / Capabilities / Prompt) fits and is comfortably tappable
  at 108×32.
- Breadcrumb, name input, and description input all stay within the viewport.
- No horizontal document scroll anywhere in the editors.
