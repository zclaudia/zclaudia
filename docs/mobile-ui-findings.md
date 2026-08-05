# Mobile UI findings — hands-on walkthrough (2026-08-06)

Recorded by driving the real app in a 375×812 viewport against a live
gateway-direct stack (gateway :3200 → server :3100 → Vite :1420), walking the
normal flows: Home → new session → chat → composer tools → session menu →
drawer → Agents → profile editor → Automations → Settings. Measurements are
from the running DOM, not from reading code.

These are **new** findings, on top of the mobile-adaptation work already landed
in `b3fde0e9..797bd505`. Everything below reproduces at 375px; 320px was also
checked (no horizontal page overflow anywhere).

---

## P0 — blocks the core flow

### 1. There is no visible way to start a new session on a phone

Three separate gates line up so that a mobile user who already has one session
cannot create another through any visible control:

- `features/sidebar/ProjectListItem.tsx:101-103` — the **mobile** branch of
  `menuButtonClass` is
  `... opacity-0 group-hover:opacity-100`. The mobile variant only changes the
  size (`w-8 h-8` vs `w-6 h-6`) and keeps the hover gate, so "New session" and
  "Project menu" are `opacity: 0` forever on touch. Verified live: both buttons
  measure 32×32 with computed `opacity: 0`.
- `features/sidebar/SessionItem.tsx:158` and
  `features/sidebar/WorktreeGroupItem.tsx:76` have the same shape for their row
  menus.
- `features/home/HomeView.tsx` — the "New session" / "Add project" CTAs render
  only in the empty state. As soon as one recent session exists, Home's only
  interactive elements are the session rows and the stats tab/range switchers.

Fix: on mobile render these row actions at `opacity-100` (hover-reveal only
from `md:` up, the inversion already used at `MessageInput.tsx:1043`), and keep
a persistent "New session" affordance on Home.

### 2. Home has no navigation affordance at all

`app/AppHeader.tsx:34` applies `hidden` whenever `isMobile && !isAgentExpanded`,
so on the Home/app view the header — and the hamburger inside it — is present in
the DOM but never painted. Verified live: `header.className` contains `hidden`
while `[aria-label="Open menu"]` exists and is unreachable.

The drawer is therefore reachable only through the Android back button
(`App.tsx` priority-5 handler) or a swipe. On iOS, in a PWA, or in the browser
shell there is no back button, so the drawer — and with it projects, Agents,
Extensions, Automations and Settings — is unreachable from Home.

Note the chat view is fine: `SessionHeader` renders its own hamburger.

Fix: show the mobile header (or at least a hamburger) on the Home view.

---

## P1 — functionality unreachable or mis-triggered

### 3. Profile editor header pushes its actions menu off-screen

`features/agents/ui/ProfileHeader.tsx:51-79` is a single non-wrapping flex row:
back-crumb (`flex-shrink-0`) + `/` + name input + a `ml-auto flex-shrink-0`
cluster holding badges, status chip and `ActionsMenu`.

Measured on the Default Coding Agent profile at 375px: the row needs
`scrollWidth: 458` against `clientWidth: 375`, and the "More actions" button
lands at `x = 424..452` — entirely outside the viewport, with the parent
clipping it (page `overflowX` is 0, so it cannot be scrolled to).

Consequence: profile-level actions (delete, set default, …) are unreachable on
a phone. Same header is used by the LLM-profile and MCP editors.

Fix: let the row wrap below `md:`, or move badges/status to a second line and
keep only the actions menu pinned right.

### 4. Automation row action buttons sit on top of the row text

In Automations, the meta line wraps into a narrow column and the row's action
buttons overlap it. Measured: the text "Permission Escalation (Default)"
occupies `x 246..304, y 219..271`; "Run now" is at `x 258..286, y 220..248` and
"Disable" at `x 290..318` — both painted over the text.

Tapping what looks like descriptive text triggers *Run now* or *Disable*.

Fix: give the row a wrapping/stacked mobile layout so the meta column and the
action cluster never share space.

### 5. Backend selector contradicts itself

Opening the drawer's backend pill shows a dropdown reading **"No backends
available"** while the pill itself and the tree below both show the connected
backend ("Dev MacBook"). The dropdown also renders 256px wide starting at
`left: 12`, so its right edge (268) spills 12px past the 256px drawer.
It additionally stays open when tapping elsewhere inside the drawer.

Fix: count the current-instance backend in that list (or word the empty state as
"No other backends"), clamp the width to the drawer, and dismiss on outside tap.

---

## P2 — space usage and layout

### 6. `AgentRequiredDialog` is a full-screen sheet for two lines of text

Measured 812px tall: content ends at ≈ y 200, buttons sit at y 756 — roughly
550px of dead space. Buttons are 164×36.

Fix: auto-height bottom sheet (or centred card) instead of `inset-0`.

### 7. Empty chat centres the composer instead of anchoring it

On an empty session the composer sits mid-screen (`top ≈ 330`), with ~280px of
empty space above and ~320px below the suggestion chips. Mobile messaging
convention is a bottom-anchored composer; centring also means the input jumps
when the keyboard opens.

### 8. Mobile tools menu is a 160px desktop dropdown

The registry-driven menu (Draft / Session Changes / Terminal / Memory /
Lineage) renders 160px wide on a 375px screen, so "Session Changes" wraps to two
lines (64px row vs 44px for the rest) and the wrapped label reads centred while
its siblings read left-aligned.

Fix: widen it (or use a bottom sheet) and give the label
`flex-1 text-left whitespace-nowrap`.

### 9. Automations shows two stacked headers

The mode header ("Automations") and the section header ("⚡ Automations")
consume ~100px of a 812px screen before any content.

---

## P3 — touch targets and polish

Effective sizes measured live (including `::before` hit-area expanders):

| Control | Size | Where |
|---|---|---|
| Session header hamburger / "…" | 32×32 | `SessionHeader.tsx` — hand-rolled `h-8 w-8`, so it misses the `IconButton` `before:-inset-1.5` expander added in `463220c6` |
| Composer selector trio | 28px tall | `PermissionSelector`, mode selector |
| Suggestion chips | 28px tall | `EmptySessionOverview` |
| Automations "New" | 61×24 | `AutomationsTab` |
| Automations delete | 24×24 | row actions |
| Orphan "Hide panel" | 22×22 | rendered at `y 58` in chat with no visible panel; `title` only, no `aria-label`, and covered by the composer container |

Other polish items:

- The composer "+" (tools) button has a `title="More tools"` but no
  `aria-label`.
- On mobile the permission selector drops its text label, leaving a bare shield
  icon with a chevron and no indication of what it controls.
- The drawer backend pill truncates to "Dev Mac…" at 136px while the 256px
  drawer has room to spare.
- The Claudia button uses an 18px raster logo (`logo-transparent-dark.png`)
  among lucide stroke icons — visually inconsistent at that size.
- Switching between shell modes needs three steps (Back to app → open drawer →
  pick mode), because the drawer swaps main nav for mode-scoped tabs.
- The project tree node renders collapsed by default, adding a tap before any
  project is visible even when only one backend exists.
- File Viewer disappears from the mobile tools menu when the project has no
  `rootPath` (`ChatInputArea.tsx:502`) with no explanation — correct behaviour,
  but silent.

---

## What already works well

Worth keeping in mind so these are not regressed:

- Attach/Send are a proper 44×44; drawer nav rows are 240×44.
- No horizontal page overflow at either 375px or 320px; suggestion chips wrap.
- The registry-driven tools menu really does surface Memory and Lineage now.
- Mode header (`MobileModeHeader`) back/hamburger get the 40px effective hit
  area from the `IconButton` expander.
- Settings drill-down, the session "…" menu, the Session-info overlay and the
  stacked editor rows all behave correctly at phone widths.
