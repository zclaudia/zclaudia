import type { LayoutNode } from './splitLayoutStore';

/**
 * Panels that may appear in more than one pane simultaneously, keyed by
 * `instanceKey`. In the MVP this is only `terminal`, and even terminal is NOT
 * arbitrarily multi-instance — it is a per-scope singleton (one terminal per
 * `(project, backend)`), enforced by `findSingletonConflict` via `instanceKey`.
 *
 * Adding a panel here requires that its store/state supports independent
 * instances per `instanceKey`. True same-project multiple terminals needs a
 * `terminalStore` change first (see the split-view plan's Follow-ups).
 */
export const MULTI_INSTANCE_PANELS = new Set<string>(['terminal']);

export function isSingleton(panelId: string): boolean {
  return !MULTI_INSTANCE_PANELS.has(panelId);
}

/**
 * Walk the layout tree and return the pane id of an existing pane that
 * conflicts with placing `(panelId, instanceKey)`:
 *
 * - For singletons: any other pane already holding `panelId` is a conflict.
 * - For per-scope (multi-instance) panels: a pane holding the same panel id AND
 *   the same `instanceKey` is a conflict (it would mirror one resource, e.g.
 *   one PTY, across two panes).
 *
 * `excludePaneId` is the pane being split-from or replaced and is never treated
 * as a self-conflict. Returns null when there is no conflict.
 */
export function findSingletonConflict(
  root: LayoutNode | null,
  panelId: string,
  instanceKey: string | undefined,
  excludePaneId: string,
): string | null {
  let conflict: string | null = null;
  const visit = (node: LayoutNode | null) => {
    if (!node || conflict) return;
    if (node.kind === 'pane') {
      if (node.id === excludePaneId) return;
      if (node.panelId !== panelId) return;
      if (isSingleton(panelId)) {
        conflict = node.id;
        return;
      }
      // Per-scope panel: conflict only on identical instanceKey.
      if (node.instanceKey === instanceKey) {
        conflict = node.id;
      }
      return;
    }
    visit(node.children[0]);
    visit(node.children[1]);
  };
  visit(root);
  return conflict;
}
