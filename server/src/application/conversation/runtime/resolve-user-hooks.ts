import { parseUserHooks, type UserHookDefinition } from '@zclaudia/shared/interaction/user-hooks';

type Db = { prepare: (sql: string) => { get: (...a: unknown[]) => unknown } };

/**
 * Load user hooks for a run: global (agent_config.hooks) first, then project
 * (projects.hooks_override) — ADDITIVE, unlike customRules' replace semantics.
 * Disabled and invalid entries are dropped (warn). Read once per run; hooks
 * don't need per-request freshness.
 */
export function resolveUserHooks(db: Db, projectId: string): UserHookDefinition[] {
  const out: UserHookDefinition[] = [];
  const globalRow = db.prepare('SELECT hooks FROM agent_config WHERE id = 1').get() as { hooks: string | null } | undefined;
  const projectRow = db.prepare('SELECT hooks_override FROM projects WHERE id = ?').get(projectId) as { hooks_override: string | null } | undefined;
  const layers: Array<[string, string | null | undefined]> = [
    ['global', globalRow?.hooks],
    ['project', projectRow?.hooks_override],
  ];
  for (const [label, raw] of layers) {
    if (!raw) continue;
    try {
      const { hooks, warnings } = parseUserHooks(JSON.parse(raw));
      for (const w of warnings) console.warn(`[UserHooks] ${label}: ${w}`);
      out.push(...hooks.filter((h) => h.enabled !== false));
    } catch {
      console.warn(`[UserHooks] corrupt ${label} hooks JSON, ignoring`);
    }
  }
  return out;
}
