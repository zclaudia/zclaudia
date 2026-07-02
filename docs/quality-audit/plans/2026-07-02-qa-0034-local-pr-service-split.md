# LocalPRService Lifecycle-Stage Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `server/src/domains/local-pr/service.ts` (~1139 lines) into a `LocalPRContext` + four lifecycle-stage collaborators + a queue scheduler, leaving `LocalPRService` as a thin delegating facade with an unchanged public API.

**Architecture:** A `LocalPRContext` class owns all shared state (6 repos, `db`, `aiDeps`, `mergeLock`, `activeReviewIds`, `activeConflictIds`, `broadcastToProject`) plus the leaf helpers and the shared refresh ops. Each lifecycle stage (`PRCreationService`, `PRReviewService`, `PRMergeService`, `PRConflictService`) is a class holding that context. `PRQueueScheduler` holds the context + the four stages and is the only cross-stage orchestrator. `LocalPRService` constructs everything and delegates. All method bodies move **verbatim**; only `this.<helper>` → `this.ctx.<helper>` and `this.<crossStageMethod>` → `this.<stage>.<method>` rewrites change.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), Vitest.

## Global Constraints

- **Behaviour-preserving refactor.** No logic, timing, ordering, or protocol change. Method bodies move verbatim.
- **Public API of `LocalPRService` is frozen.** `routes.ts` / `register.ts` must not change. The facade keeps: `getRepo`, `archiveRelatedSessions`, `checkCreatePreconditions`, `createPR`, `maybeAutoCreatePR`, `maybeAutoCreatePRForCompletedSession`, `startReview`, `mergePR`, `cancelMerge`, `reopenPR`, `revertMergedPR`, `triggerConflictResolution`, `startConflictResolution`, `tick`.
- **The regression net is `server/src/domains/local-pr/__tests__/local-pr-service.test.ts` (2236 lines).** It drives the public facade end-to-end and MUST stay green, unchanged, after every task. No new stage-level tests are required.
- Import specifiers use the `.js` extension (e.g. `'./context.js'`).
- Keep gates green per task: `prettier --write` touched files; `eslint` 0 errors on touched files; server `tsc --noEmit` clean.
- Verify commands use the project Node wrapper: `bash scripts/with-project-node.sh pnpm --filter @zclaudia/server exec …`. (If that wrapper is absent, use `export PATH="$HOME/Library/pnpm:$PATH" && pnpm --filter server exec …`.)
- Work on `main` (branch `quality-audit/remaining-open` already merged); one commit per task.

## Verification command (run after every task)

```bash
export PATH="$HOME/Library/pnpm:$PATH"
pnpm --filter server exec vitest run src/domains/local-pr   # expect: all files pass, incl. local-pr-service.test.ts
pnpm --filter server exec tsc --noEmit                       # expect: no errors
```

## File Structure

- Create `server/src/domains/local-pr/context.ts` — `LocalPRContext`: shared state + leaf helpers + refresh ops.
- Create `server/src/domains/local-pr/creation.ts` — `PRCreationService`.
- Create `server/src/domains/local-pr/review.ts` — `PRReviewService`.
- Create `server/src/domains/local-pr/merge.ts` — `PRMergeService`.
- Create `server/src/domains/local-pr/conflict.ts` — `PRConflictService`.
- Create `server/src/domains/local-pr/scheduler.ts` — `PRQueueScheduler`.
- Modify `server/src/domains/local-pr/service.ts` — becomes a facade (construct + delegate).

## Method ownership map (source lines in current `service.ts`)

| Destination | Methods (verbatim move) |
| --- | --- |
| `LocalPRContext` | `requirePR` (92), `requireAiDeps` (98), `archiveRelatedSessions` (111), `maybeRefreshPR` (307), `refreshAfterBusyState` (357), `deleteRelatedSessions` (1070), `broadcastPRUpdate` (1085), `forwardSessionStream` (1093), `resolveAgentLlmIdForProject` (1119), `hasAvailableSlot` (1131) |
| `PRCreationService` | `checkCreatePreconditions` (130), `createPR` (186), `maybeAutoCreatePR` (265), `maybeAutoCreatePRForCompletedSession` (297) |
| `PRReviewService` | `startReview` (390), `onReviewSessionComplete` (469), `cleanupReviewArtifacts` (537) |
| `PRMergeService` | `mergePR` (551), `cancelMerge` (675), `reopenPR` (728), `revertMergedPR` (741) |
| `PRConflictService` | `triggerConflictResolution` (700), `startConflictResolution` (798), `onConflictSessionComplete` (879) |
| `PRQueueScheduler` | `tick` (918), `processQueue` (932), `processFailed` (969), `processStale` (989), `processPendingReviews` (1008), `processPendingMerges` (1021), `cleanupFinishedPRs` (1035) |

**Rewrite rules applied to every moved method body:**
- Any call to a context-owned member (`requirePR`, `requireAiDeps`, `archiveRelatedSessions`, `maybeRefreshPR`, `refreshAfterBusyState`, `deleteRelatedSessions`, `broadcastPRUpdate`, `forwardSessionStream`, `resolveAgentLlmIdForProject`, `hasAvailableSlot`) or context state (`prRepo`, `projectRepo`, `llmProfileRepo`, `sessionRepo`, `messageRepo`, `wtConfigRepo`, `db`, `aiDeps`, `mergeLock`, `activeReviewIds`, `activeConflictIds`, `broadcastToProject`) → prefix with `this.ctx.`.
- Cross-stage calls: inside `PRMergeService`, `this.startConflictResolution(...)` → `this.conflict.startConflictResolution(...)`. Inside `PRQueueScheduler`, `this.startReview` → `this.review.startReview`, `this.mergePR` → `this.merge.mergePR`, `this.startConflictResolution` → `this.conflict.startConflictResolution`, `this.createPR`/`this.maybeAutoCreatePR` → `this.creation.<method>`.
- Intra-stage calls (e.g. review's `this.onReviewSessionComplete`, `this.cleanupReviewArtifacts`; conflict's `this.onConflictSessionComplete`; creation's `this.createPR`) stay as `this.<method>` — same class.
- Module-level constants (`STALE_TIMEOUT_MS`, `MAX_FINISHED_PRS_PER_PROJECT`, `LOCAL_PR_SESSION_STREAM_MESSAGE_TYPES`) move next to the class that uses them (see per-task notes) and their imports follow.

---

### Task 1: Extract `LocalPRContext`

**Files:**
- Create: `server/src/domains/local-pr/context.ts`
- Modify: `server/src/domains/local-pr/service.ts`

- [ ] **Step 1: Create `context.ts` with the shared state + helpers**

Create `server/src/domains/local-pr/context.ts`. Copy the needed imports from `service.ts` (Database type, `LocalPR`/`LocalPRStatus`, `ServerMessage`, the six repository classes, `Mutex`, and the git utils used by `maybeRefreshPR`/`refreshAfterBusyState`: `getDiff`, `getMainBranch`, `getCurrentBranch`, `getNewCommits`). Move the `LocalPRAIDeps` interface here and re-export it. Move `LOCAL_PR_SESSION_STREAM_MESSAGE_TYPES` here (used by `forwardSessionStream`).

```ts
export class LocalPRContext {
  readonly prRepo: LocalPRRepository;
  readonly projectRepo: ProjectRepository;
  readonly llmProfileRepo: LlmProfileRepository;
  readonly sessionRepo: SessionRepository;
  readonly messageRepo: SessionMessageRepository;
  readonly wtConfigRepo: WorktreeConfigRepository;
  readonly mergeLock = new Mutex();
  readonly activeReviewIds = new Set<string>();
  readonly activeConflictIds = new Set<string>();

  constructor(
    readonly db: Database,
    readonly broadcastToProject: (projectId: string, message: ServerMessage) => void,
    readonly aiDeps?: LocalPRAIDeps
  ) {
    this.prRepo = new LocalPRRepository(db);
    this.projectRepo = new ProjectRepository(db);
    this.llmProfileRepo = new LlmProfileRepository(db);
    this.sessionRepo = new SessionRepository(db);
    this.messageRepo = new SessionMessageRepository(db);
    this.wtConfigRepo = new WorktreeConfigRepository(db);
  }

  // Move verbatim from service.ts, dropping the `private` keyword:
  //   requirePR (92), requireAiDeps (98), archiveRelatedSessions (111),
  //   maybeRefreshPR (307), refreshAfterBusyState (357), deleteRelatedSessions (1070),
  //   broadcastPRUpdate (1085), forwardSessionStream (1093),
  //   resolveAgentLlmIdForProject (1119), hasAvailableSlot (1131)
  // In these bodies, `this.<repo>` / `this.broadcastToProject` / `this.aiDeps` stay as-is
  // (they are now this class's own members). `this.broadcastPRUpdate(...)` inside maybeRefreshPR
  // stays `this.broadcastPRUpdate(...)` (same class).
}
```

- [ ] **Step 2: Rewire `service.ts` to hold a `LocalPRContext`**

In `service.ts`: remove the six repo fields, `mergeLock`, `activeReviewIds`, `activeConflictIds`, and the ten moved methods. Add `private ctx: LocalPRContext;`. Rewrite the constructor to keep the backward-compat `deps`-as-function normalization, then build the context:

```ts
constructor(
  db: Database,
  broadcastToProject: (projectId: string, message: ServerMessage) => void,
  deps?: LocalPRAIDeps | ((projectId: string) => boolean)
) {
  const aiDeps: LocalPRAIDeps | undefined =
    typeof deps === 'function'
      ? {
          startAISession: () => {
            throw new Error('AI session not configured');
          },
          isProjectSlotAvailable: deps,
        }
      : deps;
  this.ctx = new LocalPRContext(db, broadcastToProject, aiDeps);
}
```

In every method still in `service.ts`, apply the rewrite rules: `this.prRepo` → `this.ctx.prRepo`, `this.requirePR` → `this.ctx.requirePR`, `this.broadcastPRUpdate` → `this.ctx.broadcastPRUpdate`, `this.refreshAfterBusyState` → `this.ctx.refreshAfterBusyState`, `this.archiveRelatedSessions` (internal call at line 640) → `this.ctx.archiveRelatedSessions`, `this.mergeLock` → `this.ctx.mergeLock`, `this.activeReviewIds`/`this.activeConflictIds` → `this.ctx.…`, `this.aiDeps`/`this.requireAiDeps` → `this.ctx.…`, `this.deleteRelatedSessions` → `this.ctx.deleteRelatedSessions`, `this.forwardSessionStream` → `this.ctx.forwardSessionStream`, `this.resolveAgentLlmIdForProject` → `this.ctx.resolveAgentLlmIdForProject`, `this.hasAvailableSlot` → `this.ctx.hasAvailableSlot`. Add public delegators `getRepo()` (`return this.ctx.prRepo;`) and `archiveRelatedSessions(pr)` (`return this.ctx.archiveRelatedSessions(pr);`). Remove the now-unused imports that only `context.ts` needs.

- [ ] **Step 3: Format + lint touched files**

```bash
export PATH="$HOME/Library/pnpm:$PATH"
pnpm --filter server exec prettier --write src/domains/local-pr/context.ts src/domains/local-pr/service.ts
pnpm --filter server exec eslint src/domains/local-pr/context.ts src/domains/local-pr/service.ts
```
Expected: prettier rewrites; eslint 0 errors.

- [ ] **Step 4: Run the verification command**

```bash
pnpm --filter server exec vitest run src/domains/local-pr
pnpm --filter server exec tsc --noEmit
```
Expected: all local-pr test files pass (incl. `local-pr-service.test.ts`); `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/domains/local-pr/context.ts server/src/domains/local-pr/service.ts
git commit -m "refactor(local-pr): extract LocalPRContext (shared state + helpers) (QA-0034)"
```

---

### Task 2: Extract `PRCreationService`

**Files:**
- Create: `server/src/domains/local-pr/creation.ts`
- Modify: `server/src/domains/local-pr/service.ts`

- [ ] **Step 1: Create `creation.ts`**

Create `PRCreationService` holding the context. Move verbatim `checkCreatePreconditions` (130), `createPR` (186), `maybeAutoCreatePR` (265), `maybeAutoCreatePRForCompletedSession` (297). Copy the imports these bodies use (git utils: `getGitStatus`, `commitAllChanges`, `getNewCommits`, `getMainBranch`, `getCurrentBranch`, `hasCommits`, `getDiff`; `resolveAgentForSession`/`NoAgentAvailableError`; `path`, etc. — include only what the moved bodies reference).

```ts
export class PRCreationService {
  constructor(private ctx: LocalPRContext) {}
  // moved methods; apply rewrite rules (this.<state/helper> -> this.ctx.<...>).
  // Intra-stage: maybeAutoCreatePR's `this.createPR(...)` (287) and `this.ctx.maybeRefreshPR(...)`
  //   (284) — createPR stays this.createPR (same class); maybeRefreshPR is on the context.
  //   maybeAutoCreatePRForCompletedSession's `this.maybeAutoCreatePR(...)` (300) stays this.<...>.
}
```

- [ ] **Step 2: Delegate from `service.ts`**

Remove those four methods from `service.ts`. Add `private creation: PRCreationService;`, construct it in the constructor after the context: `this.creation = new PRCreationService(this.ctx);`. Add delegators:

```ts
checkCreatePreconditions(projectId: string, worktreePath: string) {
  return this.creation.checkCreatePreconditions(projectId, worktreePath);
}
createPR(projectId: string, worktreePath: string, opts: Parameters<PRCreationService['createPR']>[2]) {
  return this.creation.createPR(projectId, worktreePath, opts);
}
maybeAutoCreatePR(projectId: string, worktreePath: string) {
  return this.creation.maybeAutoCreatePR(projectId, worktreePath);
}
maybeAutoCreatePRForCompletedSession(sessionId: string) {
  return this.creation.maybeAutoCreatePRForCompletedSession(sessionId);
}
```
(Match the exact original signatures for `createPR`'s options param — copy the concrete type from the moved method rather than the `Parameters<…>` shorthand if that reads more clearly.)

- [ ] **Step 3: Format + lint** — same commands as Task 1 Step 3, targeting `creation.ts` + `service.ts`.
- [ ] **Step 4: Verify** — run the verification command. Expected: all pass, `tsc` clean.
- [ ] **Step 5: Commit**

```bash
git add server/src/domains/local-pr/creation.ts server/src/domains/local-pr/service.ts
git commit -m "refactor(local-pr): extract PRCreationService (QA-0034)"
```

---

### Task 3: Extract `PRReviewService`

**Files:**
- Create: `server/src/domains/local-pr/review.ts`
- Modify: `server/src/domains/local-pr/service.ts`

- [ ] **Step 1: Create `review.ts`**

`PRReviewService` holding the context. Move verbatim `startReview` (390), `onReviewSessionComplete` (469), `cleanupReviewArtifacts` (537). Copy imports these use (`buildReviewPrompt`, `parseReviewVerdict`, `resolveAvailableProviderId`, `resolveAgentForSession`/`NoAgentAvailableError`, git utils, `rm`/`path` as referenced). Apply rewrite rules. Intra-stage: `this.onReviewSessionComplete` (458) and `this.cleanupReviewArtifacts` (485) stay `this.<...>`. `this.ctx.refreshAfterBusyState` (534) and `this.ctx.forwardSessionStream` (456) via context.

```ts
export class PRReviewService {
  constructor(private ctx: LocalPRContext) {}
  // moved methods
}
```

- [ ] **Step 2: Delegate from `service.ts`**

Remove the three methods. Add `private review: PRReviewService;`, construct `this.review = new PRReviewService(this.ctx);`. Add delegator:

```ts
startReview(prId: string, overrideProviderId?: string) {
  return this.review.startReview(prId, overrideProviderId);
}
```

- [ ] **Step 3: Format + lint** — `review.ts` + `service.ts`.
- [ ] **Step 4: Verify** — verification command. Expected: all pass.
- [ ] **Step 5: Commit**

```bash
git add server/src/domains/local-pr/review.ts server/src/domains/local-pr/service.ts
git commit -m "refactor(local-pr): extract PRReviewService (QA-0034)"
```

---

### Task 4: Extract `PRConflictService`

(Conflict is extracted before merge because `PRMergeService` will depend on it.)

**Files:**
- Create: `server/src/domains/local-pr/conflict.ts`
- Modify: `server/src/domains/local-pr/service.ts`

- [ ] **Step 1: Create `conflict.ts`**

`PRConflictService` holding the context. Move verbatim `triggerConflictResolution` (700), `startConflictResolution` (798), `onConflictSessionComplete` (879). Copy imports (`buildConflictResolutionPrompt`, `resolveAvailableProviderId`, `resolveAgentForSession`, git utils as referenced). Apply rewrite rules. Intra-stage: `triggerConflictResolution`'s `this.startConflictResolution` (724) and `startConflictResolution`'s `this.onConflictSessionComplete` (857) stay `this.<...>`. `this.ctx.refreshAfterBusyState` (695 is in cancelMerge → not here; 901 in onConflictSessionComplete → context).

```ts
export class PRConflictService {
  constructor(private ctx: LocalPRContext) {}
  // moved methods
}
```

- [ ] **Step 2: Delegate from `service.ts`**

Remove the three methods. Add `private conflict: PRConflictService;`, construct `this.conflict = new PRConflictService(this.ctx);` (before merge). Add delegators:

```ts
triggerConflictResolution(prId: string) {
  return this.conflict.triggerConflictResolution(prId);
}
startConflictResolution(prId: string, overrideProviderId?: string) {
  return this.conflict.startConflictResolution(prId, overrideProviderId);
}
```

- [ ] **Step 3: Format + lint** — `conflict.ts` + `service.ts`.
- [ ] **Step 4: Verify** — verification command. Expected: all pass.
- [ ] **Step 5: Commit**

```bash
git add server/src/domains/local-pr/conflict.ts server/src/domains/local-pr/service.ts
git commit -m "refactor(local-pr): extract PRConflictService (QA-0034)"
```

---

### Task 5: Extract `PRMergeService`

**Files:**
- Create: `server/src/domains/local-pr/merge.ts`
- Modify: `server/src/domains/local-pr/service.ts`

- [ ] **Step 1: Create `merge.ts`**

`PRMergeService` holding the context **and** a `PRConflictService` reference (merge triggers conflict resolution). Move verbatim `mergePR` (551), `cancelMerge` (675), `reopenPR` (728), `revertMergedPR` (741). Copy imports (`resolveMergeCommitSha`, git utils: `mergeBranch`, `abortMerge`, `getMainBranch`, `getCurrentBranch`, `isWorkingTreeClean`, `removeWorktree`, etc. as referenced; `rm`/`path`). Apply rewrite rules. Cross-stage: `this.startConflictResolution(...)` (654) → `this.conflict.startConflictResolution(...)`. `this.ctx.refreshAfterBusyState` (668, 695) and `this.ctx.archiveRelatedSessions` (640) via context.

```ts
export class PRMergeService {
  constructor(
    private ctx: LocalPRContext,
    private conflict: PRConflictService
  ) {}
  // moved methods
}
```

- [ ] **Step 2: Delegate from `service.ts`**

Remove the four methods. Add `private merge: PRMergeService;`, construct `this.merge = new PRMergeService(this.ctx, this.conflict);` (after conflict). Add delegators:

```ts
mergePR(prId: string) {
  return this.merge.mergePR(prId);
}
cancelMerge(prId: string) {
  return this.merge.cancelMerge(prId);
}
reopenPR(prId: string) {
  return this.merge.reopenPR(prId);
}
revertMergedPR(prId: string) {
  return this.merge.revertMergedPR(prId);
}
```

- [ ] **Step 3: Format + lint** — `merge.ts` + `service.ts`.
- [ ] **Step 4: Verify** — verification command. Expected: all pass.
- [ ] **Step 5: Commit**

```bash
git add server/src/domains/local-pr/merge.ts server/src/domains/local-pr/service.ts
git commit -m "refactor(local-pr): extract PRMergeService (QA-0034)"
```

---

### Task 6: Extract `PRQueueScheduler` and finalize the facade

**Files:**
- Create: `server/src/domains/local-pr/scheduler.ts`
- Modify: `server/src/domains/local-pr/service.ts`

- [ ] **Step 1: Create `scheduler.ts`**

`PRQueueScheduler` holding the context + the four stages. Move verbatim `tick` (918), `processQueue` (932), `processFailed` (969), `processStale` (989), `processPendingReviews` (1008), `processPendingMerges` (1021), `cleanupFinishedPRs` (1035). Move the module constants `STALE_TIMEOUT_MS` and `MAX_FINISHED_PRS_PER_PROJECT` here (used only by these methods) and their referenced imports. Apply rewrite rules and the cross-stage rewrites: `this.startReview` (951, 1015) → `this.review.startReview`; `this.mergePR` (954, 1025) → `this.merge.mergePR`; `this.startConflictResolution` (957) → `this.conflict.startConflictResolution`; any `this.createPR`/`this.maybeAutoCreatePR` → `this.creation.<...>`; `this.ctx.refreshAfterBusyState` (1004), `this.ctx.deleteRelatedSessions` (1052), `this.ctx.hasAvailableSlot` (937, 974), `this.ctx.broadcastPRUpdate` (1002) via context.

```ts
export class PRQueueScheduler {
  constructor(
    private ctx: LocalPRContext,
    private creation: PRCreationService,
    private review: PRReviewService,
    private merge: PRMergeService,
    private conflict: PRConflictService
  ) {}
  // moved methods
}
```

- [ ] **Step 2: Finalize `service.ts` as a facade**

Remove `tick` + all `process*` + `cleanupFinishedPRs`. Add `private scheduler: PRQueueScheduler;`, construct it last: `this.scheduler = new PRQueueScheduler(this.ctx, this.creation, this.review, this.merge, this.conflict);`. Add the `tick` delegator:

```ts
tick() {
  return this.scheduler.tick();
}
```

Confirm `service.ts` now contains only: imports, the `LocalPRService` class with the constructor (deps normalization + context/stage/scheduler construction) and the public delegators listed in Global Constraints. It should be ~150–250 lines.

- [ ] **Step 3: Format + lint** — `scheduler.ts` + `service.ts`.
- [ ] **Step 4: Verify** — verification command. Expected: all pass, `tsc` clean.
- [ ] **Step 5: Confirm the facade shrank**

```bash
wc -l server/src/domains/local-pr/service.ts   # expect ~150-250, down from 1139
```

- [ ] **Step 6: Commit**

```bash
git add server/src/domains/local-pr/scheduler.ts server/src/domains/local-pr/service.ts
git commit -m "refactor(local-pr): extract PRQueueScheduler; service.ts is now a facade (QA-0034)"
```

---

### Task 7: Update audit records

**Files:**
- Modify: `docs/quality-audit/findings.json`
- Modify: `docs/quality-audit/PROGRESS.md`

- [ ] **Step 1: Mark QA-0034 fixed in `findings.json`**

Set QA-0034 `status` to `"fixed"` and replace `verificationNote` with the final state, e.g.:

```
"verificationNote": "Split service.ts (1139 lines) into LocalPRContext + PRCreationService + PRReviewService + PRMergeService + PRConflictService + PRQueueScheduler; service.ts is now a ~NNN-line delegating facade with an unchanged public API. Behaviour preserved — local-pr-service.test.ts (end-to-end over the facade) green throughout; server tsc clean."
```
Fill `NNN` with the actual `wc -l` from Task 6 Step 5.

- [ ] **Step 2: Update `PROGRESS.md`**

In the "maintainability partials" section, mark QA-0034 as ✅ CLOSED (fixed) with the final line count and module list, mirroring how QA-0027 was closed.

- [ ] **Step 3: Commit**

```bash
git add docs/quality-audit/findings.json docs/quality-audit/PROGRESS.md
git commit -m "docs(quality-audit): close QA-0034 after lifecycle-stage split"
```

---

## Self-review notes

- **Spec coverage:** context (Task 1), four stages (Tasks 2–5), scheduler + facade (Task 6), records (Task 7) — all spec sections covered.
- **Ordering:** conflict (Task 4) precedes merge (Task 5) so `PRMergeService` can take a constructed `PRConflictService`; scheduler last. Matches the spec's dependency order (no cycle → plain constructor injection).
- **Type consistency:** delegator signatures copy the original method signatures verbatim; stage class names match across tasks (`PRCreationService`, `PRReviewService`, `PRMergeService`, `PRConflictService`, `PRQueueScheduler`, `LocalPRContext`).
- **Line references** are to the current `service.ts` and will drift as methods are removed; use the method **names** as the source of truth when a line no longer matches.
