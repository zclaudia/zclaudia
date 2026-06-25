# Right Sidebar Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop right sidebar's three unsynchronized sources of truth (panel visibility, global split tree, pinned tools) with a single session-scoped layout tree, so panels become pure tool definitions and there is one render path that supports split + resize.

**Architecture:** A new `rightWorkspaceStore` keyed by `sessionId` holds, per session, a binary layout tree of panes (each pane holds a `ToolRef[]` with one active tool — tab-ready) plus `primaryPaneId`/`focusedPaneId`. Opening a tool routes by the tool's `openMode` (`shared` → reuse the primary pane; `dedicated` → its own pane), overridable per call. Built-in panels stay registered in `pluginStore` but the right sidebar stops reading `panel.visible`; mobile/bottom keep their current model untouched. Delivered in two phases: Phase 1 reaches feature parity with a single render path; Phase 2 ports split/drag onto the clean base. Pane-internal tabs (Phase 3) are out of scope but the data model reserves them.

**Tech Stack:** React + Zustand (with `persist` middleware), TypeScript, Vitest. No new dependencies.

## Global Constraints

- **No new npm dependencies.** Layout/resize is custom (existing pattern); do not add `allotment`/`react-resizable-panels`.
- **Desktop-only scope.** Do not change mobile behavior. Mobile renders panels through `BottomPanel` using `panel.visible` + `bottomPanelStore`; that path must keep working. Only the desktop right sidebar moves to the workspace model.
- **Tab-ready, single tool now.** `PaneNode.tools` is always length 1 in Phases 1–2. Do not build pane tab strips (Phase 3).
- **Right-sidebar empty-state / launcher copy is English** (per commit `1f7e2de`). All user-facing strings added here are English.
- **Test commands** (run from `apps/desktop/`):
  - Store/util/`components/**/*.test.ts` (node env): `npx vitest run --config=vitest.unit.config.ts <path>`
  - React component `*.test.tsx` (jsdom): `npx vitest run --config=vitest.ui.config.ts <path>`
- **Ratio clamp** `[0.1, 0.9]`; **center deadzone** 40%; **terminal instanceKey** = `` `${backendId ?? 'no-backend'}::${projectId}` `` via `getTerminalScopeKey` — preserve these exact values when porting.
- **Conventional commits**, one per task step labeled "Commit". Frequent commits.

---

## File Structure

**New files:**
- `src/stores/rightWorkspaceStore.ts` — the session-scoped workspace store: types, tree helpers, actions, persistence + LRU.
- `src/stores/__tests__/rightWorkspaceStore.test.ts` — unit tests for tree ops, openTool routing, session isolation, LRU.
- `src/components/workspace/WorkspaceView.tsx` — recursive tree renderer (ported from `SplitLayoutView`), reads the current session's workspace.
- `src/components/workspace/PaneView.tsx` — single pane container (ported), renders the active tool via `PanelContent`.
- `src/components/workspace/__tests__/WorkspaceView.test.tsx` — render tests (single pane, split, focus ring).
- `src/utils/workspaceActions.ts` — UI-facing helpers that resolve a tool's `openMode`/`multiInstance`/`instanceKey` from the registry and call the store (`openToolInWorkspace`, `closeToolInWorkspace`, `useToolOpenState`).
- `src/utils/__tests__/workspaceActions.test.ts` — tests for registry resolution + instanceKey building.

**Moved/ported in Phase 2:**
- `src/components/workspace/dragSplit.ts` — ported from `src/components/split/dragSplit.ts` (operates on `ToolRef`).
- `src/components/workspace/ResizeDivider.tsx` — ported (near-verbatim) from `src/components/split/ResizeDivider.tsx`.
- `src/components/workspace/DropOverlay.tsx` — ported (verbatim) from `src/components/split/DropOverlay.tsx`.

**Modified:**
- `src/stores/pluginStore.ts` — add `openMode?: 'shared' | 'dedicated'` to `UIExtension`.
- `src/plugins/builtinPanels.ts` — set `openMode` per panel; drop `visible`/`onClose` reliance for right region (see Task 9).
- `src/components/RightSidebar.tsx` — slim to chrome + `WorkspaceView` + header `+` launcher; remove `hasPinned`/`showTabs`/overlap-layer/old split wiring.
- `src/components/RightSidebarEmptyState.tsx` — launcher reads registry, dispatches `openToolInWorkspace`.
- `src/features/chat/SessionChatLayout.tsx:105` — pass `sessionId` to `RightSidebar`; clean up `sessionId` workspace on session removal.
- `src/features/chat/ChatInputArea.tsx` — composer tool buttons call `openToolInWorkspace`; active state via `useToolOpenState`; delete `sessionToolsStore` publish.
- `src/features/chat/SessionHeader.tsx`, `src/features/chat/MessageList.tsx`, `src/components/chat/FileReference.tsx`, `src/components/terminal/TerminalOutput.tsx` — replace `activatePanel`/`updatePanelVisibility` right-region calls with `openToolInWorkspace`.
- `src/stores/rightSidebarStore.ts` — remove `activeTab`/`setActiveTab` (bump persist version).

**Deleted (end of Phase 2):**
- `src/stores/splitLayoutStore.ts` + `__tests__/splitLayoutStore.test.ts`
- `src/stores/sessionToolsStore.ts` + consumers
- `src/components/split/SplitLayoutView.tsx`, `PaneView.tsx`, `dragSplit.ts`, `ResizeDivider.tsx`, `DropOverlay.tsx` (and their tests) — after porting to `workspace/`.
- `src/components/rightSidebarToolIcons.ts` if no longer referenced.

---

# PHASE 1 — Unified store + single render path + parity

## Task 1: Add `openMode` to the tool registry

**Files:**
- Modify: `src/stores/pluginStore.ts` (the `UIExtension` interface, ~line 57)
- Modify: `src/plugins/builtinPanels.ts` (each `registerPanel` call)
- Test: `src/plugins/__tests__/builtinPanels.test.ts` (existing)

**Interfaces:**
- Produces: `UIExtension.openMode?: 'shared' | 'dedicated'` (default treated as `'shared'`). Consumed by `workspaceActions.ts` (Task 7).

- [ ] **Step 1: Write the failing test** — append to `src/plugins/__tests__/builtinPanels.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { usePluginStore } from '../../stores/pluginStore';
import { initBuiltinPanels } from '../builtinPanels';

describe('builtinPanels openMode', () => {
  beforeEach(() => {
    usePluginStore.setState({ panels: [] });
    initBuiltinPanels();
  });

  it('marks terminal / notifications / lineage as dedicated', () => {
    const panels = usePluginStore.getState().panels;
    const byId = (id: string) => panels.find((p) => p.id === id);
    expect(byId('terminal')?.openMode).toBe('dedicated');
    expect(byId('notifications')?.openMode).toBe('dedicated');
    expect(byId('lineage')?.openMode).toBe('dedicated');
  });

  it('marks file-viewer / draft / session-changes / memory as shared', () => {
    const panels = usePluginStore.getState().panels;
    const byId = (id: string) => panels.find((p) => p.id === id);
    expect(byId('file-viewer')?.openMode).toBe('shared');
    expect(byId('draft')?.openMode).toBe('shared');
    expect(byId('session-changes')?.openMode).toBe('shared');
    expect(byId('memory')?.openMode).toBe('shared');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config=vitest.unit.config.ts src/plugins/__tests__/builtinPanels.test.ts`
Expected: FAIL — `openMode` is `undefined`.

- [ ] **Step 3: Implement** — in `src/stores/pluginStore.ts`, add to `UIExtension` (after `defaultPlacement`):

```ts
  /** Right-sidebar workspace routing for openTool: 'shared' reuses the primary
   *  pane; 'dedicated' opens (or focuses) its own pane. Defaults to 'shared'. */
  openMode?: 'shared' | 'dedicated';
```

In `src/plugins/builtinPanels.ts`, add `openMode: 'dedicated',` to the `terminal`, `notifications`, and `lineage` `registerPanel` calls, and `openMode: 'shared',` to `file-viewer`, `draft`, `session-changes`, `memory`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config=vitest.unit.config.ts src/plugins/__tests__/builtinPanels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/pluginStore.ts src/plugins/builtinPanels.ts src/plugins/__tests__/builtinPanels.test.ts
git commit -m "feat(desktop): add openMode to tool registry for workspace routing"
```

---

## Task 2: `rightWorkspaceStore` — types + tree helpers

**Files:**
- Create: `src/stores/rightWorkspaceStore.ts`
- Test: `src/stores/__tests__/rightWorkspaceStore.test.ts`

**Interfaces:**
- Produces (pure helpers, exported for tests + Phase 2): `genId`, `newPane`, `activeToolRef`, `pathTo`, `findPane`, `findPaneWithTool`, `findToolConflict`, `replaceChild`, `removePane`, `setRatioAt`, `pickFirstPane`, `isSafeTree`, `isSplitWorkspace`.
- Produces types: `SplitDir`, `ToolRef`, `PaneNode`, `GroupNode`, `LayoutNode`, `SessionWorkspace`, `SplitResult`.

- [ ] **Step 1: Write the failing test** — create `src/stores/__tests__/rightWorkspaceStore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  newPane, findPane, findPaneWithTool, findToolConflict,
  removePane, setRatioAt, pickFirstPane, isSafeTree, isSplitWorkspace,
  type LayoutNode,
} from '../rightWorkspaceStore';

function group(a: LayoutNode, b: LayoutNode): LayoutNode {
  return { id: 'g1', kind: 'group', dir: 'row', ratio: 0.5, children: [a, b] };
}

describe('rightWorkspaceStore helpers', () => {
  it('newPane wraps a single active tool', () => {
    const p = newPane('terminal', 'be::proj');
    expect(p.kind).toBe('pane');
    expect(p.tools).toEqual([{ toolId: 'terminal', instanceKey: 'be::proj' }]);
    expect(p.activeToolId).toBe('terminal');
  });

  it('findPane locates a pane by id', () => {
    const a = newPane('file-viewer');
    const root = group(a, newPane('terminal'));
    expect(findPane(root, a.id)?.id).toBe(a.id);
    expect(findPane(root, 'nope')).toBeNull();
  });

  it('findPaneWithTool matches singleton by toolId, ignores instanceKey', () => {
    const a = newPane('file-viewer');
    const root = group(a, newPane('terminal', 'be::p'));
    expect(findPaneWithTool(root, 'file-viewer', undefined, true)).toBe(a.id);
  });

  it('findPaneWithTool matches multi-instance only on same instanceKey', () => {
    const t = newPane('terminal', 'be::p');
    const root = group(t, newPane('file-viewer'));
    expect(findPaneWithTool(root, 'terminal', 'be::p', false)).toBe(t.id);
    expect(findPaneWithTool(root, 'terminal', 'be::other', false)).toBeNull();
  });

  it('findToolConflict flags a second singleton, excluding a pane', () => {
    const a = newPane('memory');
    const b = newPane('terminal');
    const root = group(a, b);
    expect(findToolConflict(root, 'memory', undefined, true, b.id)).toBe(a.id);
    expect(findToolConflict(root, 'memory', undefined, true, a.id)).toBeNull();
  });

  it('removePane collapses a group to the surviving sibling', () => {
    const a = newPane('file-viewer');
    const b = newPane('terminal');
    const root = group(a, b);
    expect(removePane(root, b.id)).toEqual(a);
    expect(removePane(a, a.id)).toBeNull();
  });

  it('setRatioAt clamps to [0.1, 0.9]', () => {
    const root = group(newPane('a'), newPane('b')) as Extract<LayoutNode, { kind: 'group' }>;
    const updated = setRatioAt(root, 'g1', 5) as Extract<LayoutNode, { kind: 'group' }>;
    expect(updated.ratio).toBe(0.9);
  });

  it('pickFirstPane returns the leftmost pane id', () => {
    const a = newPane('a');
    expect(pickFirstPane(group(a, newPane('b')))).toBe(a.id);
  });

  it('isSafeTree validates pane shape (tools + activeToolId)', () => {
    expect(isSafeTree(newPane('a'))).toBe(true);
    expect(isSafeTree({ id: 'x', kind: 'pane', tools: [], activeToolId: '' })).toBe(false);
    expect(isSafeTree({ kind: 'pane' })).toBe(false);
  });

  it('isSplitWorkspace is true only for a group root', () => {
    expect(isSplitWorkspace(newPane('a'))).toBe(false);
    expect(isSplitWorkspace(group(newPane('a'), newPane('b')))).toBe(true);
    expect(isSplitWorkspace(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config=vitest.unit.config.ts src/stores/__tests__/rightWorkspaceStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/stores/rightWorkspaceStore.ts` with the types + helpers (the store object is added in Tasks 3–6; this step only needs the exports under test, but write the full type block now):

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SplitDir = 'row' | 'col';

/** One tool slot inside a pane. Panes hold an array (tab-ready); length 1 today. */
export interface ToolRef {
  toolId: string;
  /** Per-scope key for multi-instance tools (terminal = `${backendId}::${projectId}`). */
  instanceKey?: string;
}

export interface PaneNode {
  id: string;
  kind: 'pane';
  tools: ToolRef[];      // always length 1 in Phases 1–2
  activeToolId: string;  // == tools[0].toolId today
}

export interface GroupNode {
  id: string;
  kind: 'group';
  dir: SplitDir;
  ratio: number;         // share of the FIRST child, clamped [MIN_RATIO, MAX_RATIO]
  children: [LayoutNode, LayoutNode];
}

export type LayoutNode = PaneNode | GroupNode;

export interface SessionWorkspace {
  root: LayoutNode | null;        // null = empty → launcher
  primaryPaneId: string | null;   // default landing pane for openTool
  focusedPaneId: string | null;
}

export type SplitResult = { ok: true; newPaneId: string } | { ok: false; conflictPaneId: string };

export const MIN_RATIO = 0.1;
export const MAX_RATIO = 0.9;
export const DEFAULT_RATIO = 0.5;
const clampRatio = (r: number) => Math.max(MIN_RATIO, Math.min(MAX_RATIO, r));

export function genId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

export function newPane(toolId: string, instanceKey?: string): PaneNode {
  return { id: genId('pane'), kind: 'pane', tools: [{ toolId, instanceKey }], activeToolId: toolId };
}

/** The pane's currently-active tool ref (falls back to the first slot). */
export function activeToolRef(pane: PaneNode): ToolRef {
  return pane.tools.find((t) => t.toolId === pane.activeToolId) ?? pane.tools[0];
}

export function pathTo(root: LayoutNode | null, paneId: string): string[] | null {
  if (!root) return null;
  if (root.kind === 'pane') return root.id === paneId ? [] : null;
  for (const child of root.children) {
    const sub = pathTo(child, paneId);
    if (sub !== null) return [root.id, ...sub];
  }
  return null;
}

export function findPane(root: LayoutNode | null, paneId: string): PaneNode | null {
  if (!root) return null;
  if (root.kind === 'pane') return root.id === paneId ? root : null;
  for (const child of root.children) {
    const hit = findPane(child, paneId);
    if (hit) return hit;
  }
  return null;
}

/** First pane that already holds the tool. Singleton: match toolId. Multi: match toolId+instanceKey. */
export function findPaneWithTool(
  root: LayoutNode | null,
  toolId: string,
  instanceKey: string | undefined,
  singleton: boolean,
): string | null {
  let hit: string | null = null;
  const visit = (node: LayoutNode | null) => {
    if (!node || hit) return;
    if (node.kind === 'pane') {
      for (const t of node.tools) {
        if (t.toolId !== toolId) continue;
        if (singleton || t.instanceKey === instanceKey) { hit = node.id; return; }
      }
      return;
    }
    visit(node.children[0]);
    visit(node.children[1]);
  };
  visit(root);
  return hit;
}

/** Conflicting pane for placing (toolId, instanceKey), excluding `excludePaneId`. */
export function findToolConflict(
  root: LayoutNode | null,
  toolId: string,
  instanceKey: string | undefined,
  singleton: boolean,
  excludePaneId: string,
): string | null {
  let conflict: string | null = null;
  const visit = (node: LayoutNode | null) => {
    if (!node || conflict) return;
    if (node.kind === 'pane') {
      if (node.id === excludePaneId) return;
      for (const t of node.tools) {
        if (t.toolId !== toolId) continue;
        if (singleton || t.instanceKey === instanceKey) { conflict = node.id; return; }
      }
      return;
    }
    visit(node.children[0]);
    visit(node.children[1]);
  };
  visit(root);
  return conflict;
}

export function replaceChild(node: LayoutNode, oldId: string, replacement: LayoutNode): LayoutNode {
  if (node.id === oldId) return replacement;
  if (node.kind === 'pane') return node;
  const children = node.children.map((c) => replaceChild(c, oldId, replacement)) as [LayoutNode, LayoutNode];
  return { ...node, children };
}

export function removePane(root: LayoutNode, paneId: string): LayoutNode | null {
  if (root.kind === 'pane') return root.id === paneId ? null : root;
  const [a, b] = root.children;
  if (a.kind === 'pane' && a.id === paneId) return b;
  if (b.kind === 'pane' && b.id === paneId) return a;
  const newA = removePane(a, paneId);
  const newB = removePane(b, paneId);
  return { ...root, children: [newA ?? a, newB ?? b] };
}

export function setRatioAt(root: LayoutNode, groupId: string, ratio: number): LayoutNode {
  if (root.kind === 'pane') return root;
  const children = root.children.map((c) => setRatioAt(c, groupId, ratio)) as [LayoutNode, LayoutNode];
  return root.id === groupId ? { ...root, ratio: clampRatio(ratio), children } : { ...root, children };
}

export function pickFirstPane(root: LayoutNode | null): string | null {
  if (!root) return null;
  if (root.kind === 'pane') return root.id;
  return pickFirstPane(root.children[0]);
}

export function isSafeTree(node: unknown): node is LayoutNode {
  if (!node || typeof node !== 'object') return false;
  const n = node as { kind?: unknown };
  if (n.kind === 'pane') {
    const p = node as PaneNode;
    return (
      typeof p.id === 'string' &&
      Array.isArray(p.tools) && p.tools.length > 0 &&
      p.tools.every((t) => t && typeof t.toolId === 'string') &&
      typeof p.activeToolId === 'string' && p.activeToolId.length > 0
    );
  }
  if (n.kind === 'group') {
    const g = node as GroupNode;
    return (
      typeof g.id === 'string' &&
      (g.dir === 'row' || g.dir === 'col') &&
      typeof g.ratio === 'number' &&
      Array.isArray(g.children) && g.children.length === 2 &&
      isSafeTree(g.children[0]) && isSafeTree(g.children[1])
    );
  }
  return false;
}

export function isSplitWorkspace(root: LayoutNode | null): boolean {
  return !!root && root.kind === 'group';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config=vitest.unit.config.ts src/stores/__tests__/rightWorkspaceStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/rightWorkspaceStore.ts src/stores/__tests__/rightWorkspaceStore.test.ts
git commit -m "feat(desktop): rightWorkspaceStore types + tree helpers"
```

---

## Task 3: Store object + simple actions (ensureSession / focusPane / setRatio / closePane / resetSession / removeSession)

**Files:**
- Modify: `src/stores/rightWorkspaceStore.ts`
- Test: `src/stores/__tests__/rightWorkspaceStore.test.ts`

**Interfaces:**
- Produces store hook `useRightWorkspaceStore` with state `{ bySession: Record<string, SessionWorkspace>; order: string[] }` and actions:
  - `ensureSession(sessionId: string): void`
  - `focusPane(sessionId: string, paneId: string): void`
  - `setRatio(sessionId: string, groupId: string, ratio: number): void`
  - `closePane(sessionId: string, paneId: string): void`
  - `resetSession(sessionId: string): void`
  - `removeSession(sessionId: string): void`
- Consumes: helpers from Task 2.
- Internal helper `getWorkspace(sessionId)` returns `SessionWorkspace` (empty default).

- [ ] **Step 1: Write the failing test** — append:

```ts
import { useRightWorkspaceStore } from '../rightWorkspaceStore';

const reset = () => useRightWorkspaceStore.setState({ bySession: {}, order: [] });

describe('rightWorkspaceStore — simple actions', () => {
  beforeEach(reset);

  it('ensureSession creates an empty workspace once', () => {
    const s = useRightWorkspaceStore.getState();
    s.ensureSession('A');
    expect(useRightWorkspaceStore.getState().bySession.A)
      .toEqual({ root: null, primaryPaneId: null, focusedPaneId: null });
    s.ensureSession('A'); // idempotent
    expect(useRightWorkspaceStore.getState().order).toEqual(['A']);
  });

  it('closePane collapses the group and reassigns primary/focus', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });
    s.openTool('A', 'terminal', { openMode: 'dedicated', instanceKey: 'be::p', multiInstance: true });
    const ws = useRightWorkspaceStore.getState().bySession.A;
    const root = ws.root!;
    expect(root.kind).toBe('group');
    // close the dedicated (second) pane
    const second = (root as any).children[1].id;
    s.closePane('A', second);
    const after = useRightWorkspaceStore.getState().bySession.A;
    expect(after.root!.kind).toBe('pane');
    expect(after.focusedPaneId).toBe(after.root!.id);
    expect(after.primaryPaneId).toBe(after.root!.id);
  });

  it('setRatio updates the group ratio', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });
    s.openTool('A', 'memory', { openMode: 'dedicated' });
    const g = useRightWorkspaceStore.getState().bySession.A.root as any;
    s.setRatio('A', g.id, 0.7);
    expect((useRightWorkspaceStore.getState().bySession.A.root as any).ratio).toBeCloseTo(0.7);
  });

  it('removeSession drops the entry and order', () => {
    const s = useRightWorkspaceStore.getState();
    s.ensureSession('A');
    s.removeSession('A');
    expect(useRightWorkspaceStore.getState().bySession.A).toBeUndefined();
    expect(useRightWorkspaceStore.getState().order).toEqual([]);
  });
});
```

(This test references `openTool`, implemented in Task 4. Run only the `simple actions` block's non-openTool tests now, or implement Task 3 store skeleton + Task 4 openTool together. To keep TDD honest, **temporarily** mark the two openTool-dependent `it()` blocks with `it.skip` in this step, then un-skip in Task 4 Step 1.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config=vitest.unit.config.ts src/stores/__tests__/rightWorkspaceStore.test.ts -t "simple actions"`
Expected: FAIL — `useRightWorkspaceStore` undefined.

- [ ] **Step 3: Implement** — append the store to `src/stores/rightWorkspaceStore.ts`:

```ts
const MAX_SESSIONS = 50;
const EMPTY: SessionWorkspace = { root: null, primaryPaneId: null, focusedPaneId: null };

export interface OpenToolOpts {
  instanceKey?: string;
  target?: 'primary' | 'focused' | 'new-split';
  openMode?: 'shared' | 'dedicated';
  multiInstance?: boolean;
}

interface RightWorkspaceState {
  bySession: Record<string, SessionWorkspace>;
  /** MRU order of sessionIds; front = most recent. Used for LRU eviction. */
  order: string[];
  ensureSession: (sessionId: string) => void;
  openTool: (sessionId: string, toolId: string, opts?: OpenToolOpts) => void;
  closePane: (sessionId: string, paneId: string) => void;
  splitPane: (sessionId: string, fromPaneId: string, dir: SplitDir, toolId: string, instanceKey?: string, multiInstance?: boolean) => SplitResult;
  replaceTool: (sessionId: string, paneId: string, toolId: string, instanceKey?: string, multiInstance?: boolean) => SplitResult;
  setRatio: (sessionId: string, groupId: string, ratio: number) => void;
  focusPane: (sessionId: string, paneId: string) => void;
  resetSession: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
}

/** Bump a sessionId to the front of MRU order and evict the oldest beyond MAX. */
function touch(order: string[], bySession: Record<string, SessionWorkspace>, sessionId: string) {
  const next = [sessionId, ...order.filter((id) => id !== sessionId)];
  while (next.length > MAX_SESSIONS) {
    const victim = next.pop()!;
    delete bySession[victim];
  }
  return next;
}

export const useRightWorkspaceStore = create<RightWorkspaceState>()(
  persist(
    (set, get) => {
      /** Apply `mut` to a fresh copy of the session's workspace, then persist + touch MRU. */
      const update = (sessionId: string, mut: (ws: SessionWorkspace) => SessionWorkspace) =>
        set((s) => {
          const bySession = { ...s.bySession };
          const current = bySession[sessionId] ?? { ...EMPTY };
          bySession[sessionId] = mut({ ...current });
          const order = touch([...s.order], bySession, sessionId);
          return { bySession, order };
        });

      return {
        bySession: {},
        order: [],

        ensureSession: (sessionId) =>
          set((s) => {
            if (s.bySession[sessionId]) return {};
            const bySession = { ...s.bySession, [sessionId]: { ...EMPTY } };
            return { bySession, order: touch([...s.order], bySession, sessionId) };
          }),

        // openTool implemented in Task 4
        openTool: () => {},

        // splitPane / replaceTool implemented in Task 5
        splitPane: () => ({ ok: false, conflictPaneId: '' }),
        replaceTool: () => ({ ok: false, conflictPaneId: '' }),

        closePane: (sessionId, paneId) =>
          update(sessionId, (ws) => {
            if (!ws.root) return ws;
            const next = removePane(ws.root, paneId);
            if (next === ws.root) return ws; // not found
            const primaryPaneId =
              ws.primaryPaneId === paneId ? pickFirstPane(next) : ws.primaryPaneId;
            const focusedPaneId =
              ws.focusedPaneId === paneId ? pickFirstPane(next) : ws.focusedPaneId;
            return { root: next, primaryPaneId, focusedPaneId };
          }),

        setRatio: (sessionId, groupId, ratio) =>
          update(sessionId, (ws) => (ws.root ? { ...ws, root: setRatioAt(ws.root, groupId, ratio) } : ws)),

        focusPane: (sessionId, paneId) =>
          update(sessionId, (ws) => (findPane(ws.root, paneId) ? { ...ws, focusedPaneId: paneId } : ws)),

        resetSession: (sessionId) => update(sessionId, () => ({ ...EMPTY })),

        removeSession: (sessionId) =>
          set((s) => {
            if (!s.bySession[sessionId]) return {};
            const bySession = { ...s.bySession };
            delete bySession[sessionId];
            return { bySession, order: s.order.filter((id) => id !== sessionId) };
          }),
      };
    },
    {
      name: 'claudia-right-workspace',
      version: 1,
      partialize: (s) => ({ bySession: s.bySession, order: s.order }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<RightWorkspaceState>;
        const bySession: Record<string, SessionWorkspace> = {};
        for (const [id, ws] of Object.entries(p.bySession ?? {})) {
          const root = ws && isSafeTree(ws.root) ? ws.root : ws?.root === null ? null : null;
          bySession[id] = {
            root,
            primaryPaneId: root ? ws?.primaryPaneId ?? null : null,
            focusedPaneId: root ? ws?.focusedPaneId ?? null : null,
          };
        }
        const order = (p.order ?? []).filter((id) => id in bySession);
        return { ...current, bySession, order };
      },
    },
  ),
);

// One-time cleanup of the retired global split-layout persistence.
if (typeof localStorage !== 'undefined') {
  try { localStorage.removeItem('claudia-split-layout'); } catch { /* ignore */ }
}
```

- [ ] **Step 4: Run test to verify it passes** (the non-skipped `simple actions` tests)

Run: `npx vitest run --config=vitest.unit.config.ts src/stores/__tests__/rightWorkspaceStore.test.ts -t "simple actions"`
Expected: PASS for `ensureSession` and `removeSession`; the two openTool tests remain `it.skip`.

- [ ] **Step 5: Commit**

```bash
git add src/stores/rightWorkspaceStore.ts src/stores/__tests__/rightWorkspaceStore.test.ts
git commit -m "feat(desktop): rightWorkspaceStore skeleton + simple session actions"
```

---

## Task 4: `openTool` routing (primary reuse / dedicated own-pane / dedupe)

**Files:**
- Modify: `src/stores/rightWorkspaceStore.ts` (replace the `openTool: () => {}` stub)
- Test: `src/stores/__tests__/rightWorkspaceStore.test.ts`

**Interfaces:**
- Implements `openTool(sessionId, toolId, opts?: OpenToolOpts)`. Resolution: `target ?? (openMode === 'dedicated' ? 'new-split' : 'primary')`. Dedupe via `findPaneWithTool`. Empty workspace → seed single pane as primary+focused. `primary` → set the primary pane's `tools=[ref]`, `activeToolId`, focus it. `new-split`/`focused` → see below.

- [ ] **Step 1:** Un-skip the two openTool tests in the `simple actions` block, and add a dedicated `describe`:

```ts
describe('rightWorkspaceStore — openTool', () => {
  beforeEach(reset);

  it('seeds the first pane as primary + focused', () => {
    useRightWorkspaceStore.getState().openTool('A', 'file-viewer', { openMode: 'shared' });
    const ws = useRightWorkspaceStore.getState().bySession.A;
    expect(ws.root!.kind).toBe('pane');
    expect((ws.root as any).activeToolId).toBe('file-viewer');
    expect(ws.primaryPaneId).toBe(ws.root!.id);
    expect(ws.focusedPaneId).toBe(ws.root!.id);
  });

  it('shared tool reuses the primary pane (replaces its tool)', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });
    const primary = useRightWorkspaceStore.getState().bySession.A.primaryPaneId;
    s.openTool('A', 'session-changes', { openMode: 'shared' });
    const ws = useRightWorkspaceStore.getState().bySession.A;
    expect(ws.root!.kind).toBe('pane');
    expect(ws.root!.id).toBe(primary);
    expect((ws.root as any).activeToolId).toBe('session-changes');
  });

  it('dedicated tool opens its own pane and does not hijack the primary', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });
    s.openTool('A', 'terminal', { openMode: 'dedicated', instanceKey: 'be::p', multiInstance: true });
    const ws = useRightWorkspaceStore.getState().bySession.A;
    expect(ws.root!.kind).toBe('group');
    // primary still shows file-viewer
    const primaryPane = findPaneFor(ws.root, ws.primaryPaneId!);
    expect(primaryPane.activeToolId).toBe('file-viewer');
  });

  it('opening an already-open singleton focuses it instead of duplicating', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'memory', { openMode: 'dedicated' });
    s.openTool('A', 'terminal', { openMode: 'dedicated', instanceKey: 'be::p', multiInstance: true });
    const before = useRightWorkspaceStore.getState().bySession.A.root;
    s.openTool('A', 'memory', { openMode: 'dedicated' }); // already open
    const ws = useRightWorkspaceStore.getState().bySession.A;
    expect(countPanes(ws.root)).toBe(countPanes(before)); // no new pane
    const memPaneId = findPaneWithTool(ws.root, 'memory', undefined, true);
    expect(ws.focusedPaneId).toBe(memPaneId);
  });

  it('isolates layouts per session', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });
    s.openTool('B', 'terminal', { openMode: 'dedicated' });
    expect((useRightWorkspaceStore.getState().bySession.A.root as any).activeToolId).toBe('file-viewer');
    expect((useRightWorkspaceStore.getState().bySession.B.root as any).activeToolId).toBe('terminal');
  });
});

// test helpers
function findPaneFor(root: any, id: string): any {
  return findPane(root, id);
}
function countPanes(root: any): number {
  if (!root) return 0;
  if (root.kind === 'pane') return 1;
  return countPanes(root.children[0]) + countPanes(root.children[1]);
}
```

Add `findPane` and `findPaneWithTool` to the existing import from `'../rightWorkspaceStore'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config=vitest.unit.config.ts src/stores/__tests__/rightWorkspaceStore.test.ts -t "openTool"`
Expected: FAIL — openTool is a no-op stub.

- [ ] **Step 3: Implement** — replace the `openTool: () => {}` stub with:

```ts
        openTool: (sessionId, toolId, opts = {}) =>
          update(sessionId, (ws) => {
            const singleton = !opts.multiInstance;
            const instanceKey = opts.instanceKey;

            // 1) Already open → focus it (and make it the pane's active tool).
            const existing = findPaneWithTool(ws.root, toolId, instanceKey, singleton);
            if (existing) {
              const pane = findPane(ws.root, existing)!;
              const root = replaceChild(ws.root!, existing, { ...pane, activeToolId: toolId });
              return { ...ws, root, focusedPaneId: existing };
            }

            const ref = newPane(toolId, instanceKey);

            // 2) Empty workspace → seed as primary + focused.
            if (!ws.root) {
              return { root: ref, primaryPaneId: ref.id, focusedPaneId: ref.id };
            }

            const target = opts.target ?? (opts.openMode === 'dedicated' ? 'new-split' : 'primary');

            // 3a) primary → replace the primary pane's tool (fallback: seed if missing).
            if (target === 'primary') {
              const primaryId = ws.primaryPaneId && findPane(ws.root, ws.primaryPaneId)
                ? ws.primaryPaneId
                : pickFirstPane(ws.root);
              if (!primaryId) return { root: ref, primaryPaneId: ref.id, focusedPaneId: ref.id };
              const pane = findPane(ws.root, primaryId)!;
              const replaced: PaneNode = { ...pane, tools: [{ toolId, instanceKey }], activeToolId: toolId };
              return { ...ws, root: replaceChild(ws.root, primaryId, replaced), primaryPaneId: primaryId, focusedPaneId: primaryId };
            }

            // 3b) focused → replace the focused pane's tool.
            if (target === 'focused') {
              const focusId = ws.focusedPaneId && findPane(ws.root, ws.focusedPaneId)
                ? ws.focusedPaneId
                : pickFirstPane(ws.root)!;
              const pane = findPane(ws.root, focusId)!;
              const replaced: PaneNode = { ...pane, tools: [{ toolId, instanceKey }], activeToolId: toolId };
              return { ...ws, root: replaceChild(ws.root, focusId, replaced), focusedPaneId: focusId };
            }

            // 3c) new-split (dedicated) → split off a new pane beside the primary.
            const fromId = ws.primaryPaneId && findPane(ws.root, ws.primaryPaneId)
              ? ws.primaryPaneId
              : pickFirstPane(ws.root)!;
            const fromPane = findPane(ws.root, fromId)!;
            const group: GroupNode = {
              id: genId('grp'), kind: 'group', dir: 'row', ratio: DEFAULT_RATIO,
              children: [fromPane, ref],
            };
            return { ...ws, root: replaceChild(ws.root, fromId, group), focusedPaneId: ref.id };
          }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config=vitest.unit.config.ts src/stores/__tests__/rightWorkspaceStore.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add src/stores/rightWorkspaceStore.ts src/stores/__tests__/rightWorkspaceStore.test.ts
git commit -m "feat(desktop): rightWorkspaceStore openTool routing (shared/dedicated/dedupe)"
```

---

## Task 5: `splitPane` + `replaceTool` (for Phase 2 drag; store-level so tested here)

**Files:**
- Modify: `src/stores/rightWorkspaceStore.ts` (replace the two stubs)
- Test: `src/stores/__tests__/rightWorkspaceStore.test.ts`

**Interfaces:**
- `splitPane(sessionId, fromPaneId, dir, toolId, instanceKey?, multiInstance?)` → `SplitResult`. Inserts a new pane as the SECOND child of a new group wrapping `fromPaneId`; new pane is non-primary, focused. Conflict (singleton already elsewhere) → returns `{ ok:false }` without mutating (UI focuses the conflict instead — Phase 2).
- `replaceTool(sessionId, paneId, toolId, instanceKey?, multiInstance?)` → `SplitResult`. Swaps the pane's active tool (center-drop); conflict excludes the target pane itself.

- [ ] **Step 1: Write the failing test** — append:

```ts
describe('rightWorkspaceStore — splitPane / replaceTool', () => {
  beforeEach(reset);

  it('splitPane wraps the source pane and inserts the new pane second', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });
    const from = useRightWorkspaceStore.getState().bySession.A.root!.id;
    const res = s.splitPane('A', from, 'col', 'memory');
    expect(res.ok).toBe(true);
    const ws = useRightWorkspaceStore.getState().bySession.A;
    const root = ws.root as any;
    expect(root.kind).toBe('group');
    expect(root.dir).toBe('col');
    expect(root.children[0].id).toBe(from);
    expect(root.children[1].activeToolId).toBe('memory');
    if (res.ok) expect(ws.focusedPaneId).toBe(res.newPaneId);
  });

  it('splitPane refuses a duplicate singleton and leaves the tree unchanged', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'memory', { openMode: 'shared' });
    const from = useRightWorkspaceStore.getState().bySession.A.root!.id;
    const before = useRightWorkspaceStore.getState().bySession.A.root;
    const res = s.splitPane('A', from, 'row', 'memory');
    expect(res.ok).toBe(false);
    expect(useRightWorkspaceStore.getState().bySession.A.root).toBe(before);
  });

  it('replaceTool swaps a pane active tool', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'file-viewer', { openMode: 'shared' });
    const pane = useRightWorkspaceStore.getState().bySession.A.root!.id;
    const res = s.replaceTool('A', pane, 'memory');
    expect(res.ok).toBe(true);
    expect((useRightWorkspaceStore.getState().bySession.A.root as any).activeToolId).toBe('memory');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config=vitest.unit.config.ts src/stores/__tests__/rightWorkspaceStore.test.ts -t "splitPane"`
Expected: FAIL — stubs return `{ ok:false }`.

- [ ] **Step 3: Implement** — replace the `splitPane`/`replaceTool` stubs:

```ts
        splitPane: (sessionId, fromPaneId, dir, toolId, instanceKey, multiInstance) => {
          const ws = get().bySession[sessionId];
          if (!ws?.root || !findPane(ws.root, fromPaneId)) return { ok: false, conflictPaneId: '' };
          const singleton = !multiInstance;
          const conflict = findToolConflict(ws.root, toolId, instanceKey, singleton, ' __new__');
          if (conflict) return { ok: false, conflictPaneId: conflict };
          const fromPane = findPane(ws.root, fromPaneId)!;
          const ref = newPane(toolId, instanceKey);
          const group: GroupNode = {
            id: genId('grp'), kind: 'group', dir, ratio: DEFAULT_RATIO,
            children: [fromPane, ref],
          };
          update(sessionId, (w) => ({ ...w, root: replaceChild(w.root!, fromPaneId, group), focusedPaneId: ref.id }));
          return { ok: true, newPaneId: ref.id };
        },

        replaceTool: (sessionId, paneId, toolId, instanceKey, multiInstance) => {
          const ws = get().bySession[sessionId];
          const pane = ws?.root ? findPane(ws.root, paneId) : null;
          if (!pane) return { ok: false, conflictPaneId: '' };
          const singleton = !multiInstance;
          const conflict = findToolConflict(ws!.root, toolId, instanceKey, singleton, paneId);
          if (conflict) return { ok: false, conflictPaneId: conflict };
          const replaced: PaneNode = { ...pane, tools: [{ toolId, instanceKey }], activeToolId: toolId };
          update(sessionId, (w) => ({ ...w, root: replaceChild(w.root!, paneId, replaced), focusedPaneId: paneId }));
          return { ok: true, newPaneId: '' };
        },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config=vitest.unit.config.ts src/stores/__tests__/rightWorkspaceStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/rightWorkspaceStore.ts src/stores/__tests__/rightWorkspaceStore.test.ts
git commit -m "feat(desktop): rightWorkspaceStore splitPane + replaceTool with conflict guard"
```

---

## Task 6: LRU eviction test (locks the bound)

**Files:**
- Test: `src/stores/__tests__/rightWorkspaceStore.test.ts`

**Interfaces:** Consumes `openTool`, `bySession`, `order`, `MAX_SESSIONS` (50).

- [ ] **Step 1: Write the failing test** — append:

```ts
describe('rightWorkspaceStore — LRU eviction', () => {
  beforeEach(reset);

  it('evicts the oldest session beyond the 50-session cap', () => {
    const s = useRightWorkspaceStore.getState();
    for (let i = 0; i < 55; i++) s.openTool(`S${i}`, 'memory', { openMode: 'shared' });
    const { bySession, order } = useRightWorkspaceStore.getState();
    expect(order.length).toBe(50);
    expect(Object.keys(bySession).length).toBe(50);
    expect(bySession.S0).toBeUndefined();   // oldest evicted
    expect(bySession.S54).toBeDefined();    // newest kept
    expect(order[0]).toBe('S54');           // MRU front
  });
});
```

- [ ] **Step 2: Run test** — Run: `npx vitest run --config=vitest.unit.config.ts src/stores/__tests__/rightWorkspaceStore.test.ts -t "LRU"`
Expected: PASS (the bound is already implemented in Task 3's `touch`). If it FAILS, fix `touch`/`MAX_SESSIONS` until green.

- [ ] **Step 3: Commit**

```bash
git add src/stores/__tests__/rightWorkspaceStore.test.ts
git commit -m "test(desktop): lock rightWorkspaceStore 50-session LRU bound"
```

---

## Task 7: `workspaceActions.ts` — registry-aware open/close + active-state hook

**Files:**
- Create: `src/utils/workspaceActions.ts`
- Test: `src/utils/__tests__/workspaceActions.test.ts`

**Interfaces:**
- Produces:
  - `openToolInWorkspace(sessionId: string, toolId: string, ctx?: { projectId?: string; backendId?: string | null; target?: 'primary' | 'focused' | 'new-split' }): void` — resolves `openMode`/`multiInstance`/`instanceKey` from `pluginStore` + `MULTI_INSTANCE_PANELS`, then calls `useRightWorkspaceStore.getState().openTool`.
  - `closeToolInWorkspace(sessionId: string, toolId: string): void` — finds the pane holding `toolId` (singleton match) and calls `closePane`; runs the panel's `onClose` if present (preserves store cleanup like terminal/file-viewer/draft).
  - `useToolOpenState(sessionId: string, toolId: string): boolean` — reactive: true when `toolId` is present in the session's workspace tree (replaces `usePanelIsActive` for right-region composer buttons).
- Consumes: `usePluginStore`, `MULTI_INSTANCE_PANELS` (from `panelInstance.ts`), `getTerminalScopeKey`, `useRightWorkspaceStore`, `findPaneWithTool`.

- [ ] **Step 1: Write the failing test** — create `src/utils/__tests__/workspaceActions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { usePluginStore } from '../../stores/pluginStore';
import { useRightWorkspaceStore } from '../../stores/rightWorkspaceStore';
import { openToolInWorkspace, closeToolInWorkspace } from '../workspaceActions';

beforeEach(() => {
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  usePluginStore.setState({
    panels: [
      { id: 'memory', pluginId: 'x', type: 'panel', label: 'Memory', openMode: 'shared' },
      { id: 'terminal', pluginId: 'x', type: 'panel', label: 'Terminal', openMode: 'dedicated' },
    ] as any,
  });
});

describe('openToolInWorkspace', () => {
  it('routes a shared tool to the primary pane', () => {
    openToolInWorkspace('A', 'memory');
    const ws = useRightWorkspaceStore.getState().bySession.A;
    expect((ws.root as any).activeToolId).toBe('memory');
    expect(ws.primaryPaneId).toBe(ws.root!.id);
  });

  it('builds a terminal instanceKey from project + backend', () => {
    openToolInWorkspace('A', 'memory'); // seed primary
    openToolInWorkspace('A', 'terminal', { projectId: 'proj', backendId: 'be' });
    const ws = useRightWorkspaceStore.getState().bySession.A;
    const termPane = (ws.root as any).children.find((c: any) => c.activeToolId === 'terminal');
    expect(termPane.tools[0].instanceKey).toBe('be::proj');
  });
});

describe('closeToolInWorkspace', () => {
  it('removes the pane holding the tool', () => {
    openToolInWorkspace('A', 'memory');
    closeToolInWorkspace('A', 'memory');
    expect(useRightWorkspaceStore.getState().bySession.A.root).toBeNull();
  });
});
```

- [ ] **Step 2: Run test** — Run: `npx vitest run --config=vitest.unit.config.ts src/utils/__tests__/workspaceActions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/utils/workspaceActions.ts`:

```ts
import { usePluginStore } from '../stores/pluginStore';
import { useRightWorkspaceStore, findPaneWithTool } from '../stores/rightWorkspaceStore';
import { MULTI_INSTANCE_PANELS } from '../stores/panelInstance';
import { getTerminalScopeKey } from '../stores/terminalStore';

export interface OpenToolCtx {
  projectId?: string;
  backendId?: string | null;
  target?: 'primary' | 'focused' | 'new-split';
}

/** Resolve the instanceKey for a multi-instance tool from context (terminal only today). */
function resolveInstanceKey(toolId: string, ctx: OpenToolCtx): string | undefined {
  if (toolId === 'terminal' && ctx.projectId) {
    return getTerminalScopeKey(ctx.projectId, ctx.backendId);
  }
  return undefined;
}

export function openToolInWorkspace(sessionId: string, toolId: string, ctx: OpenToolCtx = {}): void {
  const panel = usePluginStore.getState().panels.find((p) => p.id === toolId);
  const openMode = panel?.openMode ?? 'shared';
  const multiInstance = MULTI_INSTANCE_PANELS.has(toolId);
  useRightWorkspaceStore.getState().openTool(sessionId, toolId, {
    openMode,
    multiInstance,
    instanceKey: resolveInstanceKey(toolId, ctx),
    target: ctx.target,
  });
}

export function closeToolInWorkspace(sessionId: string, toolId: string): void {
  const ws = useRightWorkspaceStore.getState().bySession[sessionId];
  if (!ws?.root) return;
  const paneId = findPaneWithTool(ws.root, toolId, undefined, true);
  if (!paneId) return;
  useRightWorkspaceStore.getState().closePane(sessionId, paneId);
  // Preserve panel-specific cleanup (terminal drawer, file viewer, draft store).
  usePluginStore.getState().panels.find((p) => p.id === toolId)?.onClose?.();
}

/** Reactive: is `toolId` present anywhere in the session's workspace tree? */
export function useToolOpenState(sessionId: string, toolId: string): boolean {
  return useRightWorkspaceStore((s) => {
    const root = s.bySession[sessionId]?.root ?? null;
    return findPaneWithTool(root, toolId, undefined, true) !== null;
  });
}
```

- [ ] **Step 4: Run test** — Run: `npx vitest run --config=vitest.unit.config.ts src/utils/__tests__/workspaceActions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/workspaceActions.ts src/utils/__tests__/workspaceActions.test.ts
git commit -m "feat(desktop): workspaceActions — registry-aware open/close + active hook"
```

---

## Task 8: `WorkspaceView` + `PaneView` (single-pane render path)

**Files:**
- Create: `src/components/workspace/PaneView.tsx`
- Create: `src/components/workspace/WorkspaceView.tsx`
- Create: `src/components/workspace/__tests__/WorkspaceView.test.tsx`

**Interfaces:**
- `WorkspaceView` props: `{ sessionId: string; projectId?: string; projectRoot?: string; workingDirectory?: string }`. Renders the session's tree; null root renders nothing (the host shows the launcher).
- `PaneView` props: `{ sessionId: string; paneId: string; focused: boolean; projectId?: string; projectRoot?: string; workingDirectory?: string }`. Renders the active tool via `PanelContent`; header shows tool label + `PanelActions` + close (`closePane`). Terminal pane decodes its `instanceKey` into projectId (port of existing `decodeTerminalProjectId`).
- Consumes: `useRightWorkspaceStore`, `activeToolRef`, `findPane`, `usePluginStore`, `PanelContent`/`PanelActions`. In Phase 2, `PaneView` also gets the drag handle + `DropOverlay`.

- [ ] **Step 1: Write the failing test** — create `src/components/workspace/__tests__/WorkspaceView.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { usePluginStore } from '../../../stores/pluginStore';
import { useRightWorkspaceStore } from '../../../stores/rightWorkspaceStore';
import { WorkspaceView } from '../WorkspaceView';

function Dummy({ panelId }: { panelId?: string }) {
  return <div data-testid={`content-${panelId}`}>content</div>;
}

beforeEach(() => {
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  usePluginStore.setState({
    panels: [
      { id: 'memory', pluginId: 'x', type: 'panel', label: 'Memory', component: Dummy },
      { id: 'file-viewer', pluginId: 'x', type: 'panel', label: 'File', component: Dummy },
    ] as any,
  });
});

describe('WorkspaceView', () => {
  it('renders a single pane with the active tool', () => {
    useRightWorkspaceStore.getState().openTool('A', 'memory', { openMode: 'shared' });
    const { getByTestId, getByText } = render(<WorkspaceView sessionId="A" />);
    expect(getByTestId('content-memory')).toBeTruthy();
    expect(getByText('Memory')).toBeTruthy();
  });

  it('renders both panes when split', () => {
    const s = useRightWorkspaceStore.getState();
    s.openTool('A', 'memory', { openMode: 'shared' });
    s.openTool('A', 'file-viewer', { openMode: 'dedicated' });
    const { getByTestId } = render(<WorkspaceView sessionId="A" />);
    expect(getByTestId('content-memory')).toBeTruthy();
    expect(getByTestId('content-file-viewer')).toBeTruthy();
  });

  it('renders nothing for an empty workspace', () => {
    const { container } = render(<WorkspaceView sessionId="A" />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test** — Run: `npx vitest run --config=vitest.ui.config.ts src/components/workspace/__tests__/WorkspaceView.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `PaneView`** — create `src/components/workspace/PaneView.tsx` (ported from `split/PaneView.tsx`, store swapped, tools-aware; the drag handle + DropOverlay are added in Phase 2 Task 13):

```tsx
import { useCallback } from 'react';
import { X } from 'lucide-react';
import { useRightWorkspaceStore, findPane, activeToolRef, type PaneNode } from '../../stores/rightWorkspaceStore';
import { usePluginStore, type UIExtension } from '../../stores/pluginStore';
import { PanelContent, PanelActions } from '../panels/PanelRenderer';

interface PaneViewProps {
  sessionId: string;
  paneId: string;
  focused: boolean;
  projectId?: string;
  projectRoot?: string;
  workingDirectory?: string;
}

/** Decode a terminal pane's instanceKey (`${backendId}::${projectId}`) into projectId. */
function decodeTerminalProjectId(instanceKey: string | undefined): string | undefined {
  if (!instanceKey) return undefined;
  const sep = instanceKey.indexOf('::');
  if (sep < 0) return undefined;
  return instanceKey.slice(sep + 2) || undefined;
}

export function PaneView({ sessionId, paneId, focused, projectId, projectRoot, workingDirectory }: PaneViewProps) {
  const root = useRightWorkspaceStore((s) => s.bySession[sessionId]?.root ?? null);
  const closePane = useRightWorkspaceStore((s) => s.closePane);
  const focusPane = useRightWorkspaceStore((s) => s.focusPane);

  const pane = findPane(root, paneId) as PaneNode | null;
  const panels = usePluginStore((s) => s.panels);
  const ref = pane ? activeToolRef(pane) : null;
  const panel: UIExtension | undefined = ref ? panels.find((p) => p.id === ref.toolId) : undefined;

  const onFocus = useCallback(() => focusPane(sessionId, paneId), [focusPane, sessionId, paneId]);
  const onClose = useCallback(() => closePane(sessionId, paneId), [closePane, sessionId, paneId]);

  if (!pane || !ref || !panel) {
    return (
      <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center text-xs text-muted-foreground">
        Unavailable panel
      </div>
    );
  }

  const effectiveProjectId =
    ref.toolId === 'terminal' ? decodeTerminalProjectId(ref.instanceKey) ?? projectId : projectId;

  return (
    <div
      data-pane-id={paneId}
      data-focused={focused ? 'true' : 'false'}
      onPointerDown={onFocus}
      className={`flex flex-col min-w-0 min-h-0 bg-card ${focused ? 'ring-1 ring-inset ring-border' : ''}`}
    >
      <div className="flex items-center gap-1 px-2 h-8 border-b border-border flex-shrink-0 select-none min-w-0">
        <span className="text-xs font-medium text-foreground truncate">{panel.label}</span>
        <div className="flex-1" />
        <PanelActions panel={panel} projectId={effectiveProjectId} />
        <button
          onClick={onClose}
          title="Close pane"
          className="p-1 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <PanelContent panel={panel} projectId={effectiveProjectId} projectRoot={projectRoot} workingDirectory={workingDirectory} />
      </div>
    </div>
  );
}
```

Then create `src/components/workspace/WorkspaceView.tsx` (ported from `split/SplitLayoutView.tsx`, store swapped, `sessionId` threaded; ResizeDivider is wired in Phase 2 — for now render groups with a static 1px divider so split still lays out):

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRightWorkspaceStore, type LayoutNode, type GroupNode } from '../../stores/rightWorkspaceStore';
import { PaneView } from './PaneView';

interface WorkspaceViewProps {
  sessionId: string;
  projectId?: string;
  projectRoot?: string;
  workingDirectory?: string;
}

export function WorkspaceView({ sessionId, projectId, projectRoot, workingDirectory }: WorkspaceViewProps) {
  const root = useRightWorkspaceStore((s) => s.bySession[sessionId]?.root ?? null);
  const focusedPaneId = useRightWorkspaceStore((s) => s.bySession[sessionId]?.focusedPaneId ?? null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const renderNode = useCallback(
    (node: LayoutNode): React.ReactNode => {
      if (node.kind === 'pane') {
        return (
          <PaneView
            key={node.id}
            sessionId={sessionId}
            paneId={node.id}
            focused={focusedPaneId === node.id}
            projectId={projectId}
            projectRoot={projectRoot}
            workingDirectory={workingDirectory}
          />
        );
      }
      return renderGroup(node);
    },
    [focusedPaneId, projectId, projectRoot, workingDirectory, sessionId],
  );

  const renderGroup = (group: GroupNode): React.ReactNode => {
    const isRow = group.dir === 'row';
    return (
      <div
        key={group.id}
        className={isRow ? 'flex flex-row min-w-0 min-h-0' : 'flex flex-col min-w-0 min-h-0'}
        style={{ flex: '1 1 0%', minWidth: 0, minHeight: 0 }}
      >
        <div style={{ flex: `${group.ratio} 1 0%`, minWidth: 0, minHeight: 0 }}>{renderNode(group.children[0])}</div>
        <div className={isRow ? 'w-px bg-border flex-shrink-0' : 'h-px bg-border flex-shrink-0'} />
        <div style={{ flex: `${1 - group.ratio} 1 0%`, minWidth: 0, minHeight: 0 }}>{renderNode(group.children[1])}</div>
      </div>
    );
  };

  if (!root) return null;
  return (
    <div ref={containerRef} className="flex flex-1 min-w-0 min-h-0">
      {renderNode(root)}
    </div>
  );
}
```

- [ ] **Step 4: Run test** — Run: `npx vitest run --config=vitest.ui.config.ts src/components/workspace/__tests__/WorkspaceView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/
git commit -m "feat(desktop): WorkspaceView + PaneView single render path (session-scoped)"
```

---

## Task 9: Rewire `RightSidebar` to render `WorkspaceView`; add header `+` launcher; thread `sessionId`

**Files:**
- Modify: `src/components/RightSidebar.tsx`
- Modify: `src/features/chat/SessionChatLayout.tsx:104-110`
- Modify: `src/components/RightSidebarEmptyState.tsx`
- Test: `src/components/__tests__/RightSidebar.test.tsx` (rewrite affected cases)

**Interfaces:**
- `RightSidebar` gains a required `sessionId: string` prop.
- Consumes `useRightWorkspaceStore` (for `isOpen = root !== null`), `WorkspaceView`, `openToolInWorkspace` (launcher + `+`).
- Empty-state launcher tiles call `openToolInWorkspace(sessionId, toolId)`.

- [ ] **Step 1: Thread `sessionId`** — in `SessionChatLayout.tsx` (line 104-110), add the prop:

```tsx
        <RightSidebar
          sessionId={sessionId}
          projectId={projectId}
          projectRoot={projectRoot}
          workingDirectory={workingDirectory}
        />
```

Also add cleanup so closed sessions don't leak workspaces. Find where a session is removed/closed in this component's effects (the existing `draft.closeEditor()` effect around line 56) and add, in the unmount/teardown for a removed session:

```tsx
import { useRightWorkspaceStore } from '../../stores/rightWorkspaceStore';
// on session teardown:
useRightWorkspaceStore.getState().ensureSession(sessionId); // ensure exists on mount
```

(Per-session eviction is handled by LRU; explicit `removeSession` is wired in Task 12 where session deletion is observed.)

- [ ] **Step 2: Rewrite `RightSidebar.tsx`** — replace the whole component body. The new shell keeps width-drag + collapse (from `rightSidebarStore`) and renders `WorkspaceView`; it drops `usePanelRegion`, `pinnedTools`, `showTabs`, the overlap layer, and all split/drag wiring (split/drag moves to Phase 2). New file:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useRightSidebarStore, RIGHT_SIDEBAR_LIMITS } from '../stores/rightSidebarStore';
import { useRightWorkspaceStore } from '../stores/rightWorkspaceStore';
import { useIsMobile } from '../hooks/useMediaQuery';
import { WorkspaceView } from './workspace/WorkspaceView';
import { RightSidebarEmptyState } from './RightSidebarEmptyState';
import { ToolLauncherMenu } from './workspace/ToolLauncherMenu';

interface RightSidebarProps {
  sessionId: string;
  projectId: string | undefined;
  projectRoot: string | undefined;
  workingDirectory?: string;
}

export function RightSidebar({ sessionId, projectId, projectRoot, workingDirectory }: RightSidebarProps) {
  const isMobile = useIsMobile();
  const widthFraction = useRightSidebarStore((s) => s.widthFraction);
  const collapsed = useRightSidebarStore((s) => s.collapsed);
  const setWidthFraction = useRightSidebarStore((s) => s.setWidthFraction);

  const hasContent = useRightWorkspaceStore((s) => (s.bySession[sessionId]?.root ?? null) !== null);
  const [launcherOpen, setLauncherOpen] = useState(false);

  // Ensure a workspace entry exists for this session (no-op if present).
  useEffect(() => { useRightWorkspaceStore.getState().ensureSession(sessionId); }, [sessionId]);

  const rootRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = 'touches' in e ? e.touches[0].clientX : e.clientX;
    startWidth.current = widthFraction;
    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      const clientX = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
      const container = rootRef.current?.parentElement?.clientWidth || window.innerWidth;
      setWidthFraction(startWidth.current + (startX.current - clientX) / container);
    };
    const cleanup = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', cleanup);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', cleanup);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', cleanup);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', cleanup);
  }, [widthFraction, setWidthFraction]);

  const expanded = !collapsed && hasContent;
  if (isMobile) return null;
  if (!hasContent) return null; // collapses naturally when the workspace is empty

  return (
    <div
      ref={rootRef}
      className={`flex flex-col flex-shrink-0 bg-card ${expanded ? 'border-l border-border' : ''} relative`}
      style={{
        width: expanded ? `${widthFraction * 100}%` : '0px',
        minWidth: expanded ? `${RIGHT_SIDEBAR_LIMITS.MIN_WIDTH_PX}px` : undefined,
        maxWidth: expanded ? `${RIGHT_SIDEBAR_LIMITS.MAX_WIDTH_FRACTION * 100}%` : undefined,
        overflow: 'hidden',
        contain: 'layout paint style',
      }}
    >
      {expanded && (
        <div
          className="absolute top-0 left-0 w-1 h-full cursor-ew-resize hover:bg-muted z-10"
          onMouseDown={onDragStart}
          onTouchStart={onDragStart}
        />
      )}

      <div className="flex min-h-9 items-center gap-1 px-2 py-1 select-none border-b border-border flex-shrink-0" data-tauri-drag-region>
        <span className="text-xs font-medium text-muted-foreground px-1">Workspace</span>
        <div className="flex-1" />
        <div className="relative">
          <button
            onClick={() => setLauncherOpen((v) => !v)}
            title="Add tool"
            aria-label="Add tool"
            className="p-1 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          {launcherOpen && (
            <ToolLauncherMenu
              sessionId={sessionId}
              projectId={projectId}
              onPick={() => setLauncherOpen(false)}
            />
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative [contain:layout_paint]">
        {hasContent ? (
          <WorkspaceView sessionId={sessionId} projectId={projectId} projectRoot={projectRoot} workingDirectory={workingDirectory} />
        ) : (
          <div className="absolute inset-0">
            <RightSidebarEmptyState projectId={projectId} projectRoot={projectRoot} />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `ToolLauncherMenu`** — create `src/components/workspace/ToolLauncherMenu.tsx`. It lists registry tools (desktop, not disabled) and dispatches `openToolInWorkspace`:

```tsx
import { usePluginStore } from '../../stores/pluginStore';
import { openToolInWorkspace } from '../../utils/workspaceActions';
import { useServerStore } from '../../stores/serverStore';

interface Props { sessionId: string; projectId?: string; onPick: () => void; }

export function ToolLauncherMenu({ sessionId, projectId, onPick }: Props) {
  const panels = usePluginStore((s) => s.panels);
  const disabled = usePluginStore((s) => s.disabledBuiltinPanels);
  const backendId = useServerStore((s) => s.activeServerId);
  const tools = panels.filter(
    (p) => (p.platforms ?? ['desktop']).includes('desktop') && !disabled.includes(p.id),
  );
  return (
    <div className="absolute right-0 top-full mt-1 z-30 min-w-40 rounded-md border border-border bg-popover py-1 shadow-md">
      {tools.map((t) => (
        <button
          key={t.id}
          onClick={() => { openToolInWorkspace(sessionId, t.id, { projectId, backendId }); onPick(); }}
          className="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-secondary"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Update `RightSidebarEmptyState`** — change its tool tiles to call `openToolInWorkspace(sessionId, toolId, { projectId, backendId })` instead of the old `sessionToolsStore` onClick callbacks. Add a `sessionId` prop and thread it from `RightSidebar` (and update its render at `RightSidebar` to pass `sessionId`). Read the current file and replace any `useSessionToolsStore`/onClick usage accordingly. Keep English copy.

- [ ] **Step 5: Update `RightSidebar.test.tsx`** — the old tests assert pinned-tool/tab/overlap behavior that no longer exists. Rewrite to the new contract:

```tsx
// Representative replacements (keep the existing render harness + beforeEach store reset):
it('renders nothing when the session workspace is empty', () => {
  const { container } = render(<RightSidebar sessionId="A" projectId="p1" projectRoot="/test" />);
  expect(container.firstChild).toBeNull();
});

it('renders the workspace when a tool is open', () => {
  useRightWorkspaceStore.getState().openTool('A', 'memory', { openMode: 'shared' });
  const { getByText } = render(<RightSidebar sessionId="A" projectId="p1" projectRoot="/test" />);
  expect(getByText('Workspace')).toBeTruthy();
});
```

Delete cases asserting `pinnedTools`, `showTabs`, drag-to-split-from-tab (split is re-tested in Phase 2). Ensure `beforeEach` resets both `useRightWorkspaceStore` and `usePluginStore` (register a Dummy `memory` panel with a `component`).

- [ ] **Step 6: Run tests + typecheck**

Run:
```
npx vitest run --config=vitest.ui.config.ts src/components/__tests__/RightSidebar.test.tsx
npx tsc --noEmit
```
Expected: PASS / no type errors. (Type errors from removed `sessionToolsStore`/`activeTab` usage are resolved in Tasks 10–12.)

- [ ] **Step 7: Commit**

```bash
git add src/components/RightSidebar.tsx src/components/workspace/ToolLauncherMenu.tsx src/components/RightSidebarEmptyState.tsx src/features/chat/SessionChatLayout.tsx src/components/__tests__/RightSidebar.test.tsx
git commit -m "feat(desktop): RightSidebar renders session workspace + header tool launcher"
```

---

## Task 10: Migrate composer tool buttons (`ChatInputArea`) to `openToolInWorkspace`

**Files:**
- Modify: `src/features/chat/ChatInputArea.tsx` (lines 112-195)
- Test: manual + existing composer tests if any.

**Interfaces:**
- Consumes `openToolInWorkspace`, `closeToolInWorkspace`, `useToolOpenState`.
- The composer still needs the panel-specific "open" side effects (terminal PTY create, file viewer search, draft editor send callback). Those stay; only the visibility/activation routing changes.

- [ ] **Step 1:** Replace each `*PanelActive` boolean derived from `usePanelIsActive` with `useToolOpenState(sessionId, '<toolId>')`. Example:

```tsx
const draftPanelActive = useToolOpenState(sessionId, 'draft');
const fileViewerPanelActive = useToolOpenState(sessionId, 'file-viewer');
const changesPanelActive = useToolOpenState(sessionId, 'session-changes');
const terminalPanelActive = useToolOpenState(sessionId, 'terminal');
const lineagePanelActive = useToolOpenState(sessionId, 'lineage');
```

- [ ] **Step 2:** Rewrite each onClick to toggle via the workspace. Keep the store-specific open side effects, replace `activatePanel`/`updatePanelVisibility` with `openToolInWorkspace`/`closeToolInWorkspace`:

```tsx
const backendId = useServerStore.getState().activeServerId;

const openDraftTool = useCallback(() => {
  if (draftPanelActive) { closeToolInWorkspace(sessionId, 'draft'); return; }
  setSendCallback((content: string) => onSendMessage(content));
  openDraftEditor(sessionId);                 // store side effect
  openToolInWorkspace(sessionId, 'draft', { projectId: currentSession?.projectId, backendId });
}, [draftPanelActive, sessionId, setSendCallback, onSendMessage, openDraftEditor, currentSession?.projectId]);

const openChangesTool = useCallback(() => {
  if (changesPanelActive) { closeToolInWorkspace(sessionId, 'session-changes'); return; }
  openToolInWorkspace(sessionId, 'session-changes');
}, [changesPanelActive, sessionId]);

const openLineageTool = useCallback(() => {
  if (lineagePanelActive) { closeToolInWorkspace(sessionId, 'lineage'); return; }
  openToolInWorkspace(sessionId, 'lineage');
}, [lineagePanelActive, sessionId]);

const openFilesTool = useCallback(() => {
  if (fileViewerPanelActive) { closeToolInWorkspace(sessionId, 'file-viewer'); return; }
  const store = useFileViewerStore.getState();
  store.togglePanel();
  store.setSearchOpen(true);
  openToolInWorkspace(sessionId, 'file-viewer');
}, [fileViewerPanelActive, sessionId]);

const openTerminalTool = useCallback(() => {
  if (!terminalProjectId) return;
  if (terminalPanelActive) { setDrawerOpen(terminalProjectId, false); closeToolInWorkspace(sessionId, 'terminal'); return; }
  const store = useTerminalStore.getState();
  if (!store.getTerminalId(terminalProjectId)) store.openTerminal(terminalProjectId);
  setDrawerOpen(terminalProjectId, true);
  openToolInWorkspace(sessionId, 'terminal', { projectId: terminalProjectId, backendId });
}, [terminalProjectId, terminalPanelActive, setDrawerOpen, sessionId]);
```

- [ ] **Step 3:** Delete the `sessionTools` `useMemo` (lines 169-187) and the `setSessionTools` publish effect (lines 190-195). Remove the `useSessionToolsStore`/`SessionTool` imports.

- [ ] **Step 4: Typecheck + run any composer tests**

Run: `npx tsc --noEmit`
Expected: no errors in `ChatInputArea.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/ChatInputArea.tsx
git commit -m "refactor(desktop): composer tool buttons drive the session workspace"
```

---

## Task 11: Migrate remaining right-region call sites

**Files:**
- Modify: `src/features/chat/SessionHeader.tsx` (line 107-108)
- Modify: `src/features/chat/MessageList.tsx` (line 512-513)
- Modify: `src/components/chat/FileReference.tsx` (line 50)
- Modify: `src/components/terminal/TerminalOutput.tsx` (line 33-34)
- Modify: `src/plugins/builtinPanels.ts` (right-region `onClose` handlers — make them call `closeToolInWorkspace` where they currently flip `updatePanelVisibility`, but they need a `sessionId`; see note)

**Interfaces:** All consume `openToolInWorkspace`. Each call site has a `sessionId`/`session` in scope (verify; `MessageList` has `session`, `FileReference` is rendered within a session context, `SessionHeader` has the session, `TerminalOutput` has `session`).

- [ ] **Step 1: SessionHeader "Changes" button** — replace:

```tsx
// was: usePluginStore.getState().updatePanelVisibility('session-changes', true); activatePanel('session-changes');
openToolInWorkspace(session.id, 'session-changes');
```

- [ ] **Step 2: MessageList terminal activation** (line 512-513) — replace `activatePanel('terminal')` + keep drawer open:

```tsx
store.setDrawerOpen(session.projectId, true);
openToolInWorkspace(session.id, 'terminal', { projectId: session.projectId, backendId: useServerStore.getState().activeServerId });
```

- [ ] **Step 3: FileReference** (line 50) — replace `activatePanel('file-viewer')`:

```tsx
openToolInWorkspace(sessionId, 'file-viewer');
```
(Thread `sessionId` into `FileReference` from its parent if not already present; it renders inside a message which has the session id.)

- [ ] **Step 4: TerminalOutput** (line 33-34) — keep `setDrawerOpen`, add workspace open:

```tsx
store.setDrawerOpen(session.projectId, true);
openToolInWorkspace(session.id, 'terminal', { projectId: session.projectId, backendId: useServerStore.getState().activeServerId });
```

- [ ] **Step 5: builtinPanels onClose** — the right-region `onClose` handlers that called `updatePanelVisibility(id, false)` (changes, memory, notifications, lineage) are now redundant for the right sidebar (the pane's close button calls `closePane` directly). Leave `terminal`/`file-viewer`/`draft` `onClose` (they do real store cleanup, invoked by `closeToolInWorkspace`). For `session-changes`/`memory`/`notifications`/`lineage`, set `onClose: undefined` (their close is pure layout removal). Verify mobile/bottom still closes them correctly — on mobile these are toggled via `updatePanelVisibility` directly elsewhere, unaffected.

- [ ] **Step 6: Typecheck + targeted tests**

Run:
```
npx tsc --noEmit
npx vitest run --config=vitest.unit.config.ts src/utils/__tests__/workspaceActions.test.ts
```
Expected: no errors; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/chat/SessionHeader.tsx src/features/chat/MessageList.tsx src/components/chat/FileReference.tsx src/components/terminal/TerminalOutput.tsx src/plugins/builtinPanels.ts
git commit -m "refactor(desktop): route right-region panel opens through the workspace"
```

---

## Task 12: Session-removal cleanup + delete `sessionToolsStore`, `splitLayoutStore`, retire `activeTab`

**Files:**
- Modify: wherever sessions are deleted/closed (search `removeSession`, `deleteSession`, `closeSession` in `src/stores/`), call `useRightWorkspaceStore.getState().removeSession(sessionId)`.
- Delete: `src/stores/sessionToolsStore.ts`, `src/components/rightSidebarToolIcons.ts` (if unreferenced).
- Delete: `src/stores/splitLayoutStore.ts` + `src/stores/__tests__/splitLayoutStore.test.ts`.
- Modify: `src/stores/runStore.ts` (it imported `sessionToolsStore`) — remove that usage.
- Modify: `src/stores/rightSidebarStore.ts` — remove `activeTab`/`setActiveTab`; bump persist `version` and drop `activeTab` in `merge`.
- Modify: `src/utils/openPanel.ts` — `activatePanel`/`isPanelActive`/`usePanelIsActive`/`deactivatePanel` keep working for **mobile/bottom** but must no longer reference `rightSidebarStore.activeTab`. For the right branch, make `activatePanel` a no-op (mobile-only utility now) and update `usePanelIsActive` to return false for right-placed panels on desktop (composer no longer uses it for right tools — it uses `useToolOpenState`). Verify no remaining desktop caller depends on the right branch.

**Interfaces:** `removeSession(sessionId)` already exists (Task 3).

- [ ] **Step 1:** Grep for `useRightSidebarStore` `.activeTab`/`setActiveTab` and `sessionToolsStore`/`useSessionToolsStore` consumers; list them:

```
cd apps/desktop && grep -rn "activeTab\|setActiveTab\|sessionToolsStore\|SessionTool\|splitLayoutStore" src
```

- [ ] **Step 2:** Remove `activeTab`/`setActiveTab` from `rightSidebarStore.ts`. Update its `merge` to strip persisted `activeTab` and bump `version` to the next integer.

- [ ] **Step 3:** Delete `sessionToolsStore.ts`, `splitLayoutStore.ts`, their tests, and `rightSidebarToolIcons.ts` if unreferenced. Remove the now-dead `panelInstance.ts`? **No** — `MULTI_INSTANCE_PANELS` is still used by `workspaceActions.ts`; keep `panelInstance.ts` but it may shrink to just `MULTI_INSTANCE_PANELS`/`isSingleton` (the tree-walking `findSingletonConflict` is superseded by `findToolConflict`; delete it if no importer remains).

- [ ] **Step 4:** Fix `runStore.ts` and any other consumer surfaced in Step 1.

- [ ] **Step 5:** Wire `removeSession` at the session-deletion site.

- [ ] **Step 6: Typecheck + full unit + ui suites**

Run:
```
npx tsc --noEmit
npx vitest run --config=vitest.unit.config.ts
npx vitest run --config=vitest.ui.config.ts
```
Expected: no type errors; suites green (delete/rewrite any remaining tests that referenced removed stores).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(desktop): remove sessionToolsStore/splitLayoutStore + retire right activeTab"
```

**Phase 1 done:** single render path, per-session layout, parity (minus live split, restored in Phase 2). Manually verify: open file → primary pane; open terminal → own pane, file not hijacked; switch session → layout follows; close pane → collapses.

---

# PHASE 2 — Restore split + drag-to-split on the clean base

## Task 13: Port `dragSplit` / `ResizeDivider` / `DropOverlay` into `workspace/`

**Files:**
- Create: `src/components/workspace/dragSplit.ts` (port of `split/dragSplit.ts`)
- Create: `src/components/workspace/ResizeDivider.tsx` (copy of `split/ResizeDivider.tsx`, import `SplitDir` from `rightWorkspaceStore`)
- Create: `src/components/workspace/DropOverlay.tsx` (verbatim copy of `split/DropOverlay.tsx`, import from `./dragSplit`)
- Create tests: `src/components/workspace/__tests__/dragSplit.test.ts` (port of `split/__tests__/dragSplit.test.ts`)

**Interfaces:**
- `dragSplit.ts` exports same names as before: `DropZone`, `resolveDropZone`, `dropZoneToDir`, `canDrop`, `disabledZones`, `useDragSplitStore`, `resolvePointerToPane`, plus a renamed payload type `ToolDragPayload { toolId: string; instanceKey?: string; multiInstance?: boolean }`.
- `canDrop`/`disabledZones`/`resolvePointerToPane` consume `findToolConflict` (from `rightWorkspaceStore`) instead of `findSingletonConflict`.

- [ ] **Step 1: Port `dragSplit.ts`** — copy `split/dragSplit.ts`, then apply these exact changes:
  - Replace `import type { LayoutNode } from '../../stores/splitLayoutStore';` → `import { findToolConflict, type LayoutNode } from '../../stores/rightWorkspaceStore';`
  - Remove `import { findSingletonConflict, isSingleton } from '../../stores/panelInstance';` and the `export { isSingleton }` line; instead `import { MULTI_INSTANCE_PANELS } from '../../stores/panelInstance';`.
  - Rename `interface PanelPayload { panelId; instanceKey? }` → `interface ToolDragPayload { toolId: string; instanceKey?: string; multiInstance?: boolean }` and update all usages.
  - In `canDrop`, replace the two `findSingletonConflict(root, payload.panelId, payload.instanceKey, X)` calls with `findToolConflict(root, payload.toolId, payload.instanceKey, !payload.multiInstance, X)`.
  - Keep `resolveDropZone`, `dropZoneToDir`, `CENTER_DEADZONE`, the drag store, and `resolvePointerToPane` otherwise identical (update the payload type name).

- [ ] **Step 2: Port test** — copy `split/__tests__/dragSplit.test.ts` to `workspace/__tests__/dragSplit.test.ts`; update imports to `../dragSplit` and `../../../stores/rightWorkspaceStore`; replace `panelId:` with `toolId:` in payloads and tree fixtures (use `newPane` from `rightWorkspaceStore`).

Run: `npx vitest run --config=vitest.unit.config.ts src/components/workspace/__tests__/dragSplit.test.ts`
Expected: PASS.

- [ ] **Step 3: Copy `ResizeDivider.tsx` + `DropOverlay.tsx`** into `workspace/` (ResizeDivider: change the `SplitDir` import to `../../stores/rightWorkspaceStore`; DropOverlay: change import to `./dragSplit`). Port their tests similarly.

Run: `npx vitest run --config=vitest.ui.config.ts src/components/workspace/__tests__/ResizeDivider.test.tsx src/components/workspace/__tests__/DropOverlay.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/
git commit -m "feat(desktop): port drag/resize/overlay primitives into workspace"
```

---

## Task 14: Wire live resize + drag-to-split into `WorkspaceView` / `PaneView` / `RightSidebar`

**Files:**
- Modify: `src/components/workspace/WorkspaceView.tsx` (real `ResizeDivider` instead of the static 1px divider; pointer move/up handlers)
- Modify: `src/components/workspace/PaneView.tsx` (drag handle on header + `DropOverlay`)
- Modify: `src/components/RightSidebar.tsx` (content-area `onPointerMove`/`onPointerUp` to drive drag, like the old wiring but calling the new store)
- Test: `src/components/workspace/__tests__/WorkspaceView.test.tsx` (add resize + multi-pane focus assertions)

**Interfaces:** Consumes `useRightWorkspaceStore.setRatio/splitPane/replaceTool/focusPane`, `useDragSplitStore`, `resolvePointerToPane`, `dropZoneToDir`, `canDrop` from `workspace/dragSplit`.

- [ ] **Step 1:** In `WorkspaceView.tsx`, restore the real `ResizeDivider` in `renderGroup` (port the original `split/SplitLayoutView.tsx` group body: pass `containerSize`, `onDrag={(delta) => setRatio(sessionId, group.id, group.ratio + delta)}`). Re-introduce the `size` state usage for `containerSize`.

- [ ] **Step 2:** In `PaneView.tsx`, add a drag handle on the header (the tool label becomes the grab affordance) that arms `useDragSplitStore.startDrag({ toolId: ref.toolId, instanceKey: ref.instanceKey, multiInstance: MULTI_INSTANCE_PANELS.has(ref.toolId) })` on `onPointerDown` (primary button only). Render `<DropOverlay paneId={paneId} />` inside the content area (after `PanelContent`).

```tsx
// header label:
<span
  className="text-xs font-medium text-foreground truncate cursor-grab active:cursor-grabbing"
  onPointerDown={(e) => {
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) return;
    useDragSplitStore.getState().startDrag({
      toolId: ref.toolId, instanceKey: ref.instanceKey,
      multiInstance: MULTI_INSTANCE_PANELS.has(ref.toolId),
    });
  }}
  title={`Drag ${panel.label} to split`}
>{panel.label}</span>
```

- [ ] **Step 3:** In `RightSidebar.tsx`, add `onPointerMove`/`onPointerUp` to the content wrapper (port the old `onContentPointerMove`/`onContentPointerUp` from the pre-refactor `RightSidebar`, but call the new store):

```tsx
const onContentPointerMove = useCallback((e: React.PointerEvent) => {
  const { active } = useDragSplitStore.getState();
  if (!active) return;
  const root = useRightWorkspaceStore.getState().bySession[sessionId]?.root ?? null;
  const hit = resolvePointerToPane(contentRef.current, root, e.clientX, e.clientY, active);
  useDragSplitStore.getState().setHover(hit?.paneId ?? null, hit?.zone ?? null, hit?.disabled ?? new Set());
}, [sessionId]);

const onContentPointerUp = useCallback((e: React.PointerEvent) => {
  const { active } = useDragSplitStore.getState();
  if (!active) return;
  const store = useRightWorkspaceStore.getState();
  const root = store.bySession[sessionId]?.root ?? null;
  const hit = resolvePointerToPane(contentRef.current, root, e.clientX, e.clientY, active);
  if (hit) {
    const split = dropZoneToDir(hit.zone);
    if (split) {
      if (canDrop(root, hit.paneId, hit.zone, active).allowed) {
        store.splitPane(sessionId, hit.paneId, split.dir, active.toolId, active.instanceKey, active.multiInstance);
      } else {
        // conflict → focus the existing pane instead of duplicating
        const existing = findPaneWithTool(root, active.toolId, active.instanceKey, !active.multiInstance);
        if (existing) store.focusPane(sessionId, existing);
      }
    } else {
      store.replaceTool(sessionId, hit.paneId, active.toolId, active.instanceKey, active.multiInstance);
    }
  }
  useDragSplitStore.getState().endDrag();
}, [sessionId]);
```

Attach `ref={contentRef}` + the two handlers to the content `div`, and import `useDragSplitStore`, `resolvePointerToPane`, `dropZoneToDir`, `canDrop` from `./workspace/dragSplit` and `findPaneWithTool` from the store. End any in-flight drag on collapse (effect mirroring the old one).

- [ ] **Step 4: Add render tests** — extend `WorkspaceView.test.tsx`:

```tsx
it('renders a ResizeDivider between split panes', () => {
  const s = useRightWorkspaceStore.getState();
  s.openTool('A', 'memory', { openMode: 'shared' });
  s.openTool('A', 'file-viewer', { openMode: 'dedicated' });
  const { container } = render(<WorkspaceView sessionId="A" />);
  expect(container.querySelector('[role="separator"]')).toBeTruthy();
});
```

- [ ] **Step 5: Run tests + typecheck**

Run:
```
npx vitest run --config=vitest.ui.config.ts src/components/workspace/__tests__/WorkspaceView.test.tsx
npx tsc --noEmit
```
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/ src/components/RightSidebar.tsx
git commit -m "feat(desktop): live resize + drag-to-split on the workspace"
```

---

## Task 15: Delete the old `split/` directory + final sweep

**Files:**
- Delete: `src/components/split/SplitLayoutView.tsx`, `PaneView.tsx`, `dragSplit.ts`, `ResizeDivider.tsx`, `DropOverlay.tsx` and their `__tests__`.
- Modify: `panelInstance.ts` — if `findSingletonConflict` now has no importer, delete it (keep `MULTI_INSTANCE_PANELS`, `isSingleton`).

- [ ] **Step 1:** `cd apps/desktop && grep -rn "components/split\|splitLayoutStore\|findSingletonConflict" src` — confirm zero references outside the files to delete.

- [ ] **Step 2:** Delete the old `split/` files and any dead `panelInstance` export surfaced.

- [ ] **Step 3: Full suite + typecheck + lint**

Run:
```
npx tsc --noEmit
npx vitest run --config=vitest.unit.config.ts
npx vitest run --config=vitest.ui.config.ts
npm run lint
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(desktop): remove legacy split layout module"
```

---

# PHASE 3 — Pane-internal tabs (FUTURE, out of scope)

Not implemented now. The model already supports it: `PaneNode.tools` is an array and `activeToolId` selects the active tab. When built, `openTool` with `target: 'tab'` would push to `pane.tools`; `PaneView` would render a tab strip when `tools.length > 1`; `closeTool` already removes a single tool and collapses the pane when empty. No structural migration required.

---

## Self-Review

**Spec coverage:**
- Per-session binding → `bySession` keyed store (Tasks 2–4), session isolation test (Task 4), follows on switch via `sessionId` prop (Task 9). ✓
- Single tool per pane, tab-ready → `PaneNode.tools[]` + `activeToolId` (Task 2), Phase 3 note. ✓
- Primary-pane reuse + dedicated → `openTool` routing (Task 4), `openMode` registry (Task 1). ✓
- Single source of truth / single render path → `WorkspaceView` only (Task 8), old paths deleted (Tasks 12, 15). ✓
- openMode default + per-call override → `OpenToolOpts.target` (Tasks 4, 7). ✓
- Header `+` launcher → `ToolLauncherMenu` (Task 9). ✓
- Persistence + LRU + drop global split persistence → Task 3 (`touch`, `localStorage.removeItem`), Task 6 (bound test). ✓
- Migration of call sites, delete sessionToolsStore, retire activeTab → Tasks 10–12. ✓
- Drag-to-split available always (handle on pane header) → Task 14. ✓
- Mobile/bottom untouched → constraint enforced; `openPanel.ts` right branch neutralized for desktop only (Task 12). ✓
- Testing strategy (tree, openTool, isolation, LRU, render tri-state) → Tasks 2–8, 14. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". Ports specify exact edits. One intentional cross-task seam: Task 3's test marks two `openTool` cases `it.skip`, un-skipped in Task 4 — documented in both.

**Type consistency:** `openTool(sessionId, toolId, OpenToolOpts)`, `splitPane(..., multiInstance?)`, `replaceTool(..., multiInstance?)`, `findToolConflict(root, toolId, instanceKey, singleton, excludePaneId)`, `findPaneWithTool(root, toolId, instanceKey, singleton)`, `activeToolRef(pane)`, `ToolRef{toolId,instanceKey?}`, `ToolDragPayload{toolId,instanceKey?,multiInstance?}` — names consistent across Tasks 2/4/5/7/13/14. `openToolInWorkspace(sessionId, toolId, ctx)` consistent across Tasks 7/9/10/11.

**Open verification item for the implementer:** confirm `FileReference`, `SessionHeader`, `MessageList`, `TerminalOutput` each have a `sessionId`/`session.id` in scope (Task 11 assumes so based on the audit); if any does not, thread it from the nearest session-aware parent.
