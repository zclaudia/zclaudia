# Impeccable UI Audit — Desktop App (2026-07-15, re-audit)

**Tool**: `impeccable` skill (`/impeccable audit`).
**Scope**: `apps/desktop/` — product register (bar = Linear/Raycast/Notion trust).
**Method**: bundled regex detector + 4 parallel review agents over current code, each finding verified in source. Excludes the 27 items fixed on 2026-07-14 (all confirmed still in place, no regressions).

## Health Score: 14/20 — Good

| # | Dimension | Score | Δ vs 07-14 | Key finding |
|---|-----------|-------|-----|-------------|
| 1 | Accessibility | **3/4** | ▲ +1 | Primitive layer solid; shared `Modal` (+ bespoke dialogs) has no focus trap; toasts/thinking not announced |
| 2 | Performance | **2/4** | ▼ −1 | Streaming hot path: full markdown re-parse + Prism re-tokenize per token; ResizeObserver thrash; loading-bar animates `width` |
| 3 | Responsive | **3/4** | = | Structural responsive solid; several mobile touch targets < 44px |
| 4 | Theming | **3/4** | = | Token system mature & dominant; raw-palette holdouts in supervision/local-pr/workflow-graph; one view mode-locked to light |
| 5 | Anti-Patterns | **3/4** | = | PASS; 2 remaining side-stripe accents, 1 nested card, inconsistent uppercase eyebrows |

**Anti-pattern verdict: PASS (does not look AI-generated).** Absolute bans essentially held — no gradient text, no decorative glass, no bounce easing, no hero-metric template, no identical-card grids.

> **Why the total is unchanged despite a11y improving:** the a11y fixes landed (▲), but this pass scanned *deeper* into secondary feature areas the first audit didn't reach (supervision, local-pr, openspec, meta-workflow, workflows). Those surfaced new Performance/Theming holdouts. The **core surfaces fixed on 07-14 remain excellent**; the new findings cluster in less-central panels.

---

## Systemic patterns (root causes)

- **No dialog focus trap anywhere.** The shared `Modal` sets `aria-modal`/moves focus in, but Tab escapes to the inert background. Same in `ConfirmDialog`, `GoalDialog`, and ad-hoc dialogs. One fix in `Modal` covers most editors.
- **Async status is invisible to screen readers.** Toasts, "Thinking…" status, retry — none use `role="status"`/`aria-live`.
- **Status-color maps are the theming-leak hotspot, again.** Newer feature panels (supervision, local-pr, workflow edges, phase graph) hardcode `text-yellow-500`/`green-500`/`cyan-500`/hex instead of `--success`/`--warning`/`--destructive`. Same class the 07-14 pass fixed in DashboardHome/McpServerEditor — it re-appears wherever a new status map is authored without the token vocabulary.
- **Streaming render path is unthrottled.** Every token delta re-parses the whole message + re-highlights code, and (past 80 msgs) re-attaches every ResizeObserver. Concentrated in the single busiest UX moment.

---

## Findings backlog (discuss + check off one by one)

Status legend: `[ ]` open · `[~]` discussing · `[x]` done · `[-]` won't-fix

### P1 — fix before release

- [x] **P1-1 Shared `Modal` has no focus trap (systemic)** — DONE. Extracted `utils/focusTrap.ts` (`getFocusable` + `trapTab`, WCAG 2.1.2/2.4.3) and wired it into `components/ui/Modal.tsx` (backs many editors), `components/ConfirmDialog.tsx`, `components/GoalDialog.tsx` — Tab/Shift+Tab now cycle within the dialog. Unit tests in `utils/__tests__/focusTrap.test.ts` (7 passing); Modal tests still green.
- [x] **P1-2 Supervision status badges: raw palette, light-mode AA failures** — DONE. Extracted `features/supervision/components/statusStyles.ts` (`taskStatusStyle` + `ACTION_BUTTON`), collapsing the 14-status lifecycle onto semantic tokens (primary/success/warning/destructive/muted) — label carries the exact state, color the category. `TaskCard.tsx` + `TaskDetail.tsx` now share it; removed both duplicate `statusConfig` maps, the raw approve/reject/resolve buttons, PASS/FAIL text, running pulse dot, and review-notes tint. AA passes in all 5 themes.
- [x] **P1-3 PhaseGraphScreen mode-locked to light** — DONE. `PhaseGraphScreen.tsx`: `STATUS_COLOR` fixed-hex map → `STATUS_TOKEN` semantic map; node bg/border now `hsl(var(--token)/a)`, text `--card-foreground`, subtitle `--muted-foreground`. Also drove React-Flow `colorMode` from `useTheme()`/`isDarkTheme` and tokened the Background dots so the whole canvas (Controls included) adapts across light/dark themes.
- [x] **P1-4 Toasts not announced to screen readers** — DONE. `components/ToastContainer.tsx`: container now `role="region" aria-label="Notifications"`; each card `role="alert"` (errors, assertive) / `role="status"` (success+info, polite) so it's read on insertion. Replaced the clickable-`<div>` card with keyboard-reachable controls — a real action `<button>` (named by title) only when `toast.onClick` is set, plus a dismiss `<button aria-label="Dismiss notification">`; icon marked `aria-hidden`. Bonus: tokenized the raw `green/red/blue-500` type styles → `--success/--destructive/--primary`. 5 new tests (7 total passing).

### P2 — next pass

- [x] **P2-1 Streaming re-parse + re-highlight per token** — DONE. `MessageList.tsx`: wrapped `CodeBlock` in `memo` so completed code blocks in a streaming message skip Prism re-tokenization (only the block whose code string grew re-highlights); added a local `useAnimationFrameThrottle` hook that coalesces the markdown parse to ≤1×/frame (raw prop still updates every frame, so streaming stays smooth; always converges to the final value). 761 chat tests green.
- [x] **P2-2 Virtualized MessageList thrashes ResizeObservers** — DONE. `MessageList.tsx`: replaced the inline `ref={el => setMeasuredRef(...)}` with a cached stable per-index ref factory (`getMeasureRef`), so React only invokes it on real mount/unmount instead of tearing down + re-attaching every observer each render; and batched the height-state flush into one `requestAnimationFrame` per frame (`scheduleHeightFlush`) instead of a `setItemHeights(new Map())` per observer callback. rAF cancelled on unmount + list reset.
- [x] **P2-3 `animate-loading-bar` animates `width`+`margin-left`** — DONE. `styles/index.css`: keyframe now sweeps a fixed 40%-wide segment with `transform: translateX()` (GPU-composited) instead of animating `width`/`margin-left` (layout+paint every frame while a run is active). Added a `prefers-reduced-motion` override that pins a static full-width bar so the affordance stays visible.
- [x] **P2-4 `Select` custom listbox has no keyboard nav** — DONE. `components/ui/Select.tsx`: full listbox keyboard model — ArrowUp/Down (skip disabled), Home/End, type-ahead, Enter/Space to select, ArrowUp/Down opens onto the selected option; roving DOM focus among the option buttons (`tabIndex=-1`) with `aria-activedescendant`/`aria-controls` on the listbox+trigger, Tab closes. 6 unit tests. Shared component → fixes every consumer at once.
- [x] **P2-5 `NewIssueDialog` no dialog semantics / Esc / label association** — DONE. Refactored to the shared `Modal` (dialog role + `aria-modal` + focus trap + Esc + backdrop for free) and wired `htmlFor`/`id` on the Type select and Title input; `text-red-500` error → `text-destructive`.
- [x] **P2-6 `GoalDialog` fields no label association** — DONE. `components/GoalDialog.tsx`: `useId`-based `htmlFor`/`id` pairs on Objective / Token budget / Max turns (focus trap was already added in P1-1).
- [x] **P2-7 Local-PR status map raw palette** — DONE. `LocalPRCard.tsx`: both `STATUS_CONFIG` and `EXECUTION_STATE_CONFIG` maps + the fallback now use semantic tokens (primary/success/warning/destructive/muted); also swept two stragglers in the same file — the close-action `hover:text-red-400` and the `actionError` `text-red-500` → `text-destructive`. File is now token-only.
- [x] **P2-8 WorkflowEdge mixes tokens + hardcoded hex** — DONE. `WorkflowEdge.tsx`: error/condition_false/loop_exhausted → `hsl(var(--destructive))`, condition_true → `hsl(var(--success))`, loop → `hsl(var(--warning))` for both stroke and label (loop stays amber, exhausted goes red to preserve the distinction). Dash patterns unchanged; labels now adapt across themes.
- [x] **P2-9 Side-stripe accent border** — DONE. `EditCapabilityForm.tsx`: `border-l-2 border-primary pl-2` → a contained `rounded-md bg-muted/40 p-2.5` sub-form region (no colored stripe). Also swept 3 `text-red-500` validation/error leaks → `text-destructive`.
- [x] **P2-10 Nested card** — DONE. `ActiveChangeCard.tsx`: the inner "Next Action" box dropped its `border border-border`, now a borderless `bg-secondary/50` fill inside the outer card.
- [x] **P2-11 BottomPanel mobile close button ~28px (< 44px)** — DONE. `BottomPanel.tsx`: the mobile full-screen overlay close is now a `min-h-[44px] min-w-[44px]` centered hit target (icon unchanged); added an `aria-label` (it previously had only `title`).

### P3 — polish

- [x] **P3-1 Live "Thinking…" status not announced** — DONE. `LoadingIndicator.tsx`: added an `sr-only` `aria-live="polite"` "Assistant is working…" label (stable, so the per-second timer / animated dots don't spam a reader; plain aria-live to avoid colliding with the retry banner's `role="status"`), and marked the decorative dots + progress bar `aria-hidden`.
- [x] **P3-2 Inconsistent uppercase eyebrows across sections** — DONE. Added shared `components/ui/typography.ts` `EYEBROW` token (`text-[11px] font-medium uppercase tracking-wide text-muted-foreground`) and applied it across ActiveChangeCard, TaskDetail (×5), CompactionMarkerCard (×4), LocalIssueDetailView (×2), AutomationsTab (×2), AutomationWorkflowDetail — one source of truth, no more size/tracking/weight drift. (WorkspaceDocsPanel had no matching eyebrows — audit ref was stale.)
- [x] **P3-3 NotificationItem unread stripe** — DONE. `NotificationItem.tsx`: `border-l-2 border-primary` → a leading `bg-primary` dot; row border removed.
- [x] **P3-4 Scattered `text-red-*`/`text-emerald-*` instead of tokens** — DONE. Swept 8 files to tokens: CommentList, CreateIssueDialog, ReviewStep, SubIssueDetailScreen, SkillDirsEditor (red + amber diagnostics), CodexOAuthCard + CodexOAuthSection (emerald → success), ActiveTasksPanel (status dots → destructive/warning/primary/muted-foreground). All palette-clean.
- [x] **P3-5 `ImageLightbox` missing `aria-modal`** — DONE. Added `aria-modal="true"`.
- [x] **P3-6 DashboardHome heading skip h1→h3** — DONE. Section header `<h3>` → `<h2>` (styling unchanged).
- [x] **P3-7 Chat scroll-to-bottom 36px on mobile** — DONE. `ChatMessagePane.tsx`: `w-11 h-11 md:w-9 md:h-9` (44px mobile, 36px desktop).
- [x] **P3-8 MessageInput attachment remove 24px on mobile** — DONE. Attachment remove → `w-7 h-7` + an invisible `before:-inset-2` slop = 44px mobile hit target (desktop unchanged); composer send/attach `h-10 w-10` → `h-11 w-11 md:h-10 md:w-10`.

---

## Deliberate fixed surfaces — verified, NOT flagged

- `TerminalOutput.tsx` (zinc/red terminal chrome) and `setup/WindowsSetup.tsx:668` (`bg-[#1a1a2e]` setup console) — intentional fixed-dark terminal surfaces; `red-300 on red-950` contrast is fine.
- `NotchWindow.tsx` (black macOS notch HUD), `ClaudiaBallWindow.tsx:348` (self-contained floating orb) — own windows, theme-independent by design.
- `app/MobileOverlays.tsx:70-96` — ships full `dark:` variants, adapts in both modes (not a leak).
- All `backdrop-blur` uses are modal scrims / notch HUD / toast over ≥80% opaque backdrops — purposeful, not decorative glass.

## Done well (keep)

- Generated-token single source of truth (`config.mjs`) with 5 variants — no drift in core surfaces; all 07-14 status-color fixes intact.
- Strong shared primitive layer added since 07-14: `FormField` + `Input`, accessible `Toggle`, `Modal` with `aria-modal` + initial focus.
- MessageList virtualized (threshold 80, 900px overscan), images click-to-load, lazy panes use skeletons.
- Structural responsive holds: `max-w-*`/`min-w-0` bubbles, `overflow-x-auto` on tables/code, `min-h-[44px]` session rows, safe drawer width at 320px.

## Suggested fix order

1. **P1 a11y — focus trap in shared `Modal`** (covers ConfirmDialog/GoalDialog too) + toast live regions — `/impeccable harden`
2. **P1 theming — status maps to tokens** (supervision, PhaseGraph, then local-pr/WorkflowEdge) — `/impeccable colorize`
3. **P2 perf — throttle streaming render path** (rAF batch + memo CodeBlock + stable measure ref) — `/impeccable optimize`
4. **P2 a11y — Select keyboard nav, migrate NewIssueDialog/GoalDialog to primitives** — `/impeccable harden`
5. Re-run `/impeccable audit`, finish with `/impeccable polish`.
