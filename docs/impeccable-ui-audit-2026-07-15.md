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
- [ ] **P2-4 `Select` custom listbox has no keyboard nav** — `components/ui/Select.tsx:132-227`. Roles correct but only Esc handled — no Arrow/Home/End/type-ahead, focus never enters listbox. WCAG 2.1.1. Fix: arrow-key nav + `aria-activedescendant`, open onto selected. _Cmd: /impeccable harden_
- [ ] **P2-5 `NewIssueDialog` no dialog semantics / Esc / label association** — `features/openspec/components/NewIssueDialog.tsx:70-116`. Overlay `<div>` no `role="dialog"`/`aria-modal`/focus/Esc; Type select + Title input labels lack `htmlFor`/`id`. Fix: reuse shared `Modal`/`FormField`. _Cmd: /impeccable harden_
- [ ] **P2-6 `GoalDialog` fields no label association** — `components/GoalDialog.tsx:59,73,85`. Objective/token-budget/max-turns labels lack `htmlFor`+`id`. Fix: wire ids or migrate to `FormField`. _Cmd: /impeccable harden_
- [x] **P2-7 Local-PR status map raw palette** — DONE. `LocalPRCard.tsx`: both `STATUS_CONFIG` and `EXECUTION_STATE_CONFIG` maps + the fallback now use semantic tokens (primary/success/warning/destructive/muted); also swept two stragglers in the same file — the close-action `hover:text-red-400` and the `actionError` `text-red-500` → `text-destructive`. File is now token-only.
- [x] **P2-8 WorkflowEdge mixes tokens + hardcoded hex** — DONE. `WorkflowEdge.tsx`: error/condition_false/loop_exhausted → `hsl(var(--destructive))`, condition_true → `hsl(var(--success))`, loop → `hsl(var(--warning))` for both stroke and label (loop stays amber, exhausted goes red to preserve the distinction). Dash patterns unchanged; labels now adapt across themes.
- [ ] **P2-9 Side-stripe accent border** — `features/openspec/components/init/EditCapabilityForm.tsx:42` (`border-l-2 border-primary pl-2`). Same absolute-ban pattern removed on 07-14. Fix: indent + `bg-muted/30`, or neutral hairline. _Cmd: /impeccable polish_
- [ ] **P2-10 Nested card** — `features/supervision/components/ActiveChangeCard.tsx:66` (outer card) wraps bordered `bg-secondary/20` box at `:93`. Fix: flatten inner to borderless region. _Cmd: /impeccable polish_
- [ ] **P2-11 BottomPanel mobile close button ~28px (< 44px)** — `components/BottomPanel.tsx:175-180` (`p-1.5`+`w-4 h-4`). Only dismiss for full-screen mobile overlay. Fix: `min-h/w-[44px]`. _Cmd: /impeccable adapt_

### P3 — polish

- [ ] **P3-1 Live "Thinking…" status not announced** — `features/chat/LoadingIndicator.tsx:155-206`. Rotating message + progress bar no `role="status"`/`aria-live`; dots/bar no text alt. Fix: wrap in `role="status" aria-live="polite"`.
- [ ] **P3-2 Inconsistent uppercase eyebrows across sections** — `ActiveChangeCard.tsx:69,94`; `supervision/TaskDetail.tsx:69,100,117,134,174`; `chat/CompactionMarkerCard.tsx:59,69,86,100`; `LocalIssueDetailView.tsx:157,172`; `WorkspaceDocsPanel.tsx:171,184`; `AutomationsTab.tsx:320,342`; `AutomationWorkflowDetail.tsx:100`. Mixed `text-xs`/`text-[10px]`/`text-[11px]`, `tracking-wide`/`wider`/none, `font-medium`/`semibold` — templating tell. Fix: one shared label token; demote/remove where content is self-evident. _Cmd: /impeccable typeset_
- [ ] **P3-3 NotificationItem unread stripe** — `components/notifications/NotificationItem.tsx:57` (`border-l-2 border-primary`). Borderline (functional) side-stripe. Fix: leading `bg-primary` dot instead of colored edge. _Cmd: /impeccable polish_
- [ ] **P3-4 Scattered `text-red-*`/`text-emerald-*` instead of tokens** — `features/local-issues/.../CommentList.tsx:109,126,196`, `CreateIssueDialog.tsx:209,310`, `openspec/.../ReviewStep.tsx:75,82,99`, `SubIssueDetailScreen.tsx:271,282`, `agents/SkillDirsEditor.tsx:71-157`, `agents/CodexOAuthCard.tsx:51-92` & `CodexOAuthSection.tsx:186` (`bg-emerald-600`), `ActiveTasksPanel.tsx:27-33`. Renders OK but bypasses tuned tokens. Fix: `text-destructive`/`text-success`/`bg-success`. _Cmd: /impeccable colorize_
- [ ] **P3-5 `ImageLightbox` missing `aria-modal`** — `features/attachments/components/ImageLightbox.tsx:23-24`. Has role/Esc/labeled close but no `aria-modal="true"`. Fix: add it.
- [ ] **P3-6 DashboardHome heading skip h1→h3** — `features/dashboard/DashboardHome.tsx:179`→`:507`. No h2. Fix: section headers to `<h2>`.
- [ ] **P3-7 Chat scroll-to-bottom 36px on mobile** — `features/chat/ChatMessagePane.tsx:447-454` (`w-9 h-9`). Fix: `w-11 h-11` on mobile.
- [ ] **P3-8 MessageInput attachment remove 24px on mobile** — `features/chat/MessageInput.tsx:1007-1013` (`w-6 h-6`); composer send/attach `h-10 w-10` (40px) also marginal. Fix: ≥44px mobile hit areas.

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
