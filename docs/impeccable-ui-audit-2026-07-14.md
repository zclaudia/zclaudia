# Impeccable UI Audit — Desktop App (2026-07-14)

**Tool**: `impeccable` skill (`/impeccable audit`), installed at `.claude/skills/impeccable/` (gitignored).
**Scope**: `apps/desktop/` — product register (bar = Linear/Raycast/Notion trust).
**Method**: bundled regex detector + 4 parallel review agents reading core surfaces, each finding verified in code.

## Health Score: 14/20 — Good (address the weak dimension: Accessibility)

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | **2/4** | Form `<label>`s not associated with inputs; custom switches lack `role="switch"`; icon buttons rely on `title` only |
| 2 | Performance | 3/4 | Universal `* {}` transition includes `box-shadow` — repaint cost in dense UI |
| 3 | Responsive | 3/4 | Structural responsive is good; mobile drawer lacks focus trap |
| 4 | Theming | 3/4 | Mature generated-token system, but localized hardcoded-color leaks |
| 5 | Anti-Patterns | 3/4 | No major AI tells; only local side-stripes, bounce dots, nested cards |

**Anti-pattern verdict: PASS (does not look AI-generated).** Distinctive mature product UI, generated-token single source of truth. Tells are all localized.

---

## Systemic patterns (root causes, not one-offs)

- **A11y gaps cluster in hand-rolled controls.** Custom switch/select/input/resize-handle → missing `role`/`aria`/label association. Anything routed through shared `Toggle`/`Select` is correct. **Root cause: no unified, a11y-built-in form primitive.**
- **Theming leaks cluster in status colors.** Body/border use tokens; status badges (success/error/warning/idle) fall back to hardcoded `-500`.
- **Contrast failures almost all come from stacked `opacity`**, not wrong tokens.

---

## Findings backlog (discuss + check off one by one)

Status legend: `[ ]` open · `[~]` discussing · `[x]` done · `[-]` won't-fix

### P1 — fix before release (incl. WCAG AA violations)

- [x] **P1-1 No `prefers-reduced-motion` anywhere** — `apps/desktop/src/styles/index.css:437-508`. `loading-bar 2s infinite` etc. never quiet down. Fix: global reduce block (mirror existing `.no-transitions *` pattern). _Cmd: /impeccable animate_
- [x] **P1-2 Form `<label>`s not associated with inputs (systemic)** — `ProjectSettings.tsx:344,357,422`; `McpServerEditor.tsx:503,531,542,554,566` + OAuth `726-774`; `LlmProfileEditor.tsx:660,676`; `WorkflowEditor.tsx:343,352,495`. Missing `htmlFor`/`id`. WCAG 1.3.1/4.1.2. _Cmd: /impeccable harden_
- [x] **P1-3 Reduced-opacity body text drops below 4.5:1** — `MessageList.tsx:103,1001,1094`; `HomeView.tsx:233,238`; `BackgroundTaskPanel.tsx:56,106,110,140,148`. `text-muted-foreground` × `opacity-50/70`. Fix: full-opacity token; opacity for decoration only.
- [x] **P1-4 Save failure swallowed** — `WorkflowEditor.tsx:247`. `catch` only `console.error`; button returns to idle, user thinks it saved. Needs error state + inline message. _Cmd: /impeccable harden_
- [x] **P1-5 Side-stripe accent borders (absolute ban)** — `InlinePermissionRequest.tsx:187` (`border-l-4`); `ProjectSettings.tsx:495,608` (`border-l-2 border-primary/30`). Fix: full 1px hairline / bg tint / indentation.
- [x] **P1-6 Bounce-easing loading dots** — `LoadingIndicator.tsx:168,172,176`. `animate-bounce` = tell + no reduce fallback. Fix: 150-250ms opacity/pulse.
- [x] **P1-7 Icon-only buttons rely on `title` only (no `aria-label`)** — `MessageInput.tsx:1063,1067,1082,1092,1114,1179,1188`; `SessionHeader.tsx:153,370`.

### P2 — next pass

- [x] **P2-1 Placeholder `/50` opacity → ~1.95:1 (invisible)** — `NewAgentProfileModal.tsx:128` (only outlier; all other inputs use full-opacity placeholder). Fix: drop `/50`.
- [x] **P2-2 `--muted-foreground` on `--muted` = 4.07:1 (body fails)** — source `apps/desktop/scripts/tokens/config.mjs` (light muted-foreground 43%→~40% L, regen). Affects `text-muted-foreground` inside any `bg-muted` chip/inline-code.
- [x] **P2-3 Hardcoded palette leaks (25 hex + 37 gray/slate utils)** — heaviest: `DashboardHome.tsx:37-99,430-435`; `McpServerEditor.tsx:61-68,363,494-495,875`; `LoadingIndicator.tsx:124-153,238`. Map status colors → `--success/--destructive/--warning/--muted-foreground`. _Cmd: /impeccable colorize_
- [x] **P2-4 Universal `*` transition includes `box-shadow`** — `styles/index.css:504-508`. Non-composited repaint on every node. Fix: scope to themed surfaces; drop `box-shadow` from universal list.
- [x] **P2-5 Custom switches missing `role="switch"`/`aria-checked`** — `ProjectSettings.tsx:470,586`; `McpServerEditor.tsx:461`; `InteractionItem.tsx:196-205` (also hardcoded `bg-white` knob). Shared `Toggle` (PermissionSettings) does it right — reuse it.
- [x] **P2-6 Four different input visual grammars** — `McpServerEditor.tsx:508` (`bg-secondary/50 ring-2`) vs `FIELD_CLASS` (Profile/LLM) vs `ProjectSettings` (`bg-input`, no ring) vs rounded-full (Permission/Workflow). Extract one shared `Input`.
- [x] **P2-7 Custom dropdown missing combobox semantics** — `LlmProfileEditor.tsx:1360` (`ProviderTypeSelector`: no `aria-haspopup/expanded`, no listbox/arrow-key nav). Also fetch-models dialog `LlmProfileEditor.tsx:1266` lacks `role="dialog"`/focus trap/Esc.
- [x] **P2-8 Lazy panes use centered spinner, not skeleton** — `App.tsx:77-81` (`LazyFallback`).
- [x] **P2-9 Resize/drag handles keyboard-inaccessible** — `Sidebar.tsx:791-796`; `RightSidebar.tsx:213-219`; `BottomPanel.tsx:197-201`. Bare `div`, no `role="separator"`/aria-value/keys.
- [x] **P2-10 Mobile sidebar drawer no dialog semantics / focus trap** — `Sidebar.tsx:691-695`. No `role="dialog"`/`aria-modal`; scrim is non-button `div`.
- [x] **P2-11 Number inputs without programmatic label** — `PermissionSettings.tsx:431,449,471` (`SettingsRow` title is a `<div>`).

### P3 — polish

- [x] **P3-1 Nested cards** — `McpServerEditor.tsx:713,781`; `InteractionItem.tsx:611+627`. Flatten inner border/bg to divider/spacing.
- [x] **P3-2 Primary CTA same weight as secondary** — `InteractionItem.tsx:378,443,719` (`bg-muted/60` Submit/Approve). Give primary `bg-primary text-primary-foreground`.
- [x] **P3-3 prose `p` line-height 1.8 too loose** — `styles/index.css:680` (`li` 1.75 @693). Product register → ~1.65 / ~1.55.
- [x] **P3-4 Home view starts with `<h2>`, skips `<h1>`** — `HomeView.tsx:170` (DashboardHome:176 does it right).
- [x] **P3-5 Notch subtitle `text-white/40` @11px ~3.6:1** — `NotchWindow.tsx:60`. Raise to `/55`+ (black surface is intentionally theme-independent; only opacity is the concern).
- [x] **P3-6 `terminal-selection` has no default in `darkAccents`** — `config.mjs:96-111`; a future 6th dark theme would ship without it. Add a default.

---

## Contrast reference (verified math, WCAG relative luminance)

**Fails:** muted-fg on muted (light) **4.07:1**; placeholder `/50` **1.95:1**.
**Passes (thin):** muted-fg on bg (light) 4.65:1; on card 4.83:1; primary on white 5.47:1.
**Passes (comfortable):** warning-fg on warning 5.03 (light)/7.04 (dark); all dark muted-fg 5.5-6.5:1; fg on bg 16.3 (light)/14.9 (dark).

## Done well (keep)

- Generated-token single source of truth (`config.mjs` → `@generated`-guarded CSS), 5 theme variants, algorithmic neutrals — no drift.
- Semantic z-index scale, no `999/9999` anywhere.
- Empty states teach the next action (HomeView / DashboardHome / Notch).
- System font stack, `font-synthesis:none`, `.no-transitions` load-flash guard.
- Glassmorphism is purposeful (all uses on 80-95% opaque backdrops), not decorative default.

## Suggested fix order

1. P1 accessibility (extract one a11y-built-in shared form primitive → covers P1-2, P2-5, P2-6, P2-7, P2-11 at once) — `/impeccable harden`
2. P1 motion (`prefers-reduced-motion` + bounce dots) — `/impeccable animate`
3. P2 theming (status colors → tokens) — `/impeccable colorize`
4. Re-run `/impeccable audit`, finish with `/impeccable polish`
