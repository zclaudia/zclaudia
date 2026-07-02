# Batch 05: Desktop UI Feature Layer Audit

Date: 2026-07-01

Scope: `apps/desktop/src/app`, `apps/desktop/src/components`, `apps/desktop/src/features`, `apps/desktop/src/contexts`, and `apps/desktop/src/plugins`.

Score: 59 / 100

## Summary

The desktop UI layer has strong user-facing test coverage and the full UI Vitest suite is currently green. The app has already split many feature areas into local modules, and complex interactions such as settings, chat, sidebar navigation, right workspace panels, file previews, and mobile setup all have targeted tests.

The weak points are scale, boundaries, and test partition health. Several UI modules are very large, the `components/` layer is used both for shared primitives and feature containers, architecture checks still fail on a component importing feature state, and the component-only Vitest configuration fails while the broader UI suite passes. Formatting and React-hook warning debt are also heavy enough that they reduce the signal of ordinary development checks.

## Gate Results

| Gate / Check              | Result | Evidence                                                                                                                  |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| Architecture check        | Fail   | Still flags `RightSidebarEmptyState.tsx` for importing `features/git/store`; other baseline findings also remain.         |
| UI feature ESLint         | Fail   | 516 files, 1 error, 521 warnings. The single error is the baseline `AutomationTree.tsx` no-unused-expressions issue.      |
| UI feature Prettier       | Fail   | 457 files in this batch scope need formatting.                                                                            |
| Representative UI tests   | Pass   | 6 files, 375 tests passed under `vitest.ui.config.ts`.                                                                    |
| Settings-manager UI tests | Pass   | 5 files, 150 tests passed under `vitest.ui.config.ts`.                                                                    |
| Full UI suite             | Pass   | `vitest.ui.config.ts`: 196 files, 2199 tests passed.                                                                      |
| Components-only suite     | Fail   | `vitest.components.config.ts`: 49 files passed, 4 files failed; 680 tests passed, 16 failed, plus 1 unhandled mock error. |

The jsdom warnings for navigation and canvas APIs appear during UI tests but did not prevent the full UI suite from passing.

## Scale Snapshot

- Files in scope: 516 TypeScript/TSX files.
- Lines in scope: about 96,451 lines.
- Largest production files include:
  - `apps/desktop/src/features/settings/LlmProfileManager.tsx`: 1663 lines.
  - `apps/desktop/src/features/settings/AgentManager.tsx`: 1456 lines.
  - `apps/desktop/src/features/chat/MessageInput.tsx`: 1306 lines.
  - `apps/desktop/src/features/settings/McpServerSettings.tsx`: 1209 lines.
  - `apps/desktop/src/features/chat/MessageList.tsx`: 1165 lines.
  - `apps/desktop/src/features/sidebar/Sidebar.tsx`: 736 lines.
  - `apps/desktop/src/components/notch/NotchWindow.tsx`: 713 lines.

## Score Breakdown

- Architecture boundaries: 8 / 20
- Type and interface contracts: 10 / 15
- Test quality: 15 / 20
- Maintainability: 6 / 15
- Reliability: 9 / 15
- Security and privacy: 7 / 10
- Engineering experience: 4 / 5

## Strengths

- Full UI coverage is broad: 196 UI test files and 2199 tests passed.
- Settings, chat input, chat list, tool-call rendering, sidebar, right sidebar, and setup flows have targeted test coverage.
- `MessageList` virtualizes large message lists past a threshold and tracks row heights.
- `ansi_up` escapes raw HTML by default before `TerminalOutput` injects ANSI-rendered output.
- File-type icons inline static bundled SVG strings from `material-file-icons`, not user-provided SVG.
- Several features have good local decomposition, such as sidebar data/actions helpers, facade-backed setup flows, and feature-specific test files.

## Findings

### Shared Components Layer Has Ambiguous Ownership

The architecture check flags `RightSidebarEmptyState.tsx` because a shared component imports `features/git/store`. The broader pattern is that `components/` contains both reusable UI and application containers such as `SettingsPanel`, which imports many `features/settings/*` modules directly. This makes dependency direction harder to enforce.

Recommended direction: define `components/` as reusable/shared only, and move feature-aware containers into `app/` or the owning `features/*` area. Keep shared UI components prop-driven and expand the architecture rule once the intended ownership model is explicit.

### Several UI Modules Are Too Large

The largest UI production files are form-heavy and behavior-heavy: `LlmProfileManager.tsx` is 1663 lines, `AgentManager.tsx` is 1456 lines, `MessageInput.tsx` is 1306 lines, `McpServerSettings.tsx` is 1209 lines, and `MessageList.tsx` is 1165 lines. These files combine data loading, validation, transient UI state, rendering, and interaction behavior.

Recommended direction: split high-risk files by behavior rather than visual sections: form reducers, validation/serialization helpers, data loaders, row/card subcomponents, and keyboard/attachment handlers. Keep tests at the extracted boundary so behavior stays locked.

### MessageInput Stores Attachments As Full Data URLs Without A Local Limit

`MessageInput` reads pasted/selected files with `FileReader.readAsDataURL`, stores them in component state, mirrors them into draft refs, and passes them to `onSend`. There is image downscaling, but no visible size/count limit in this path. Large files can bloat memory and persisted draft state before they reach server-side checks.

Recommended direction: add shared attachment validation before reading files, enforce size/count/type limits, and prefer the streaming/upload attachment path for larger files. Add tests for oversized paste/select behavior.

### Components-Only Test Partition Is Not Healthy

The full UI suite passes, but `vitest.components.config.ts` fails: `ActiveSessionsPanel.test.tsx`, `MobileSetup.test.tsx`, `Sidebar.test.tsx`, and `ChangeListItem.test.tsx` account for 16 failing tests and one unhandled mock error. Failures include stale expectations around active sessions/mobile setup and a mock missing `isMobileViewport` after `openPanel` started depending on it.

Recommended direction: either repair the components partition so it is a valid fast gate, or remove it from recommended workflows. Align mocks with shared setup and make component tests assert current behavior rather than old gateway/local assumptions.

### UI Lint Signal Is Noisy

The UI feature scope has 1 lint error and 521 warnings. Warning hotspots are non-null assertions, React `set-state-in-effect`, React refresh boundaries, unused variables, explicit `any`, exhaustive deps, refs, and static components. The single error is already captured in Batch 00, but this scope remains difficult to use as a reliable daily signal.

Recommended direction: fix the single lint error first, then reduce production-source warnings in the large UI files and React hook rule categories. Keep test-only mock `any` cleanup separate from production warning cleanup.

### UI Formatting Drift Is Large

Prettier reports 457 files in this UI scope as needing formatting. This includes app shell files, components, feature modules, and tests. The UI layer has enough visual churn that inconsistent formatting will keep creating review noise.

Recommended direction: include UI files in the repository-wide mechanical format pass, then keep `format:check` mandatory before UI refactors.

## Test Gaps

- No test covers oversized attachment selection/paste in `MessageInput`.
- Architecture checks do not yet distinguish reusable shared UI from app-level containers in `components/`.
- The full UI suite is green, but the component-only partition is not trustworthy until stale tests and mocks are corrected.
- Large settings/chat components have many scenario tests, but fewer reducer-level tests for validation, serialization, and keyboard/attachment state machines.
- Accessibility checks are mostly implicit through Testing Library queries; there is no automated a11y pass in the evaluated gates.

## Suggested Fix Order

1. Fix `AutomationTree.tsx` no-unused-expressions to restore UI lint gate.
2. Repair or retire `vitest.components.config.ts` as a fast component gate.
3. Move `RightSidebarEmptyState` feature dependencies out of shared `components/` or relocate the component.
4. Add size/count/type validation before `MessageInput` reads attachment files into memory.
5. Split `MessageInput`, `MessageList`, `LlmProfileManager`, `AgentManager`, and `McpServerSettings` along behavior boundaries.
6. Run the mechanical formatting pass for UI files.
7. Reduce React hook warnings in production UI components.

## Next Batch

Batch 06 should evaluate `e2e/` and `scripts/`: test orchestration, deployment/build scripts, release helpers, architecture-check tooling, shell safety, reproducibility, and CI/developer workflow reliability.
