/**
 * Panels that may appear in more than one pane simultaneously, keyed by
 * `instanceKey`. In the MVP this is only `terminal`, and even terminal is NOT
 * arbitrarily multi-instance — it is a per-scope singleton (one terminal per
 * `(project, backend)`), enforced via `instanceKey`.
 *
 * Adding a panel here requires that its store/state supports independent
 * instances per `instanceKey`. True same-project multiple terminals needs a
 * `terminalStore` change first (see the split-view plan's Follow-ups).
 */
export const MULTI_INSTANCE_PANELS = new Set<string>(['terminal']);

export function isSingleton(panelId: string): boolean {
  return !MULTI_INSTANCE_PANELS.has(panelId);
}
