import { parseToolRule } from '@zclaudia/shared/interaction/tool-rule-syntax';
import type { UnifiedPermissionPolicy } from '@zclaudia/shared/interaction/permissions';

type Db = {
  prepare: (sql: string) => { get: (...a: any[]) => unknown; run: (...a: any[]) => unknown };
};

/**
 * Persist an approval-modal "always allow" rule into the project's permission
 * override. Returns false (and writes nothing) when the rule text doesn't
 * parse — the client validates first, this is the wire-level backstop.
 */
export function promoteRuleToProjectOverride(db: Db, projectId: string, ruleText: string): boolean {
  const parsed = parseToolRule(ruleText);
  if (!parsed.ok) {
    console.warn(`[PermissionPromotion] unparseable rule "${ruleText}": ${parsed.error}`);
    return false;
  }
  const row = db
    .prepare('SELECT agent_permission_override FROM projects WHERE id = ?')
    .get(projectId) as { agent_permission_override: string | null } | undefined;
  let override: Partial<UnifiedPermissionPolicy> = {};
  if (row?.agent_permission_override) {
    try {
      override = JSON.parse(row.agent_permission_override) as Partial<UnifiedPermissionPolicy>;
    } catch {
      console.warn('[PermissionPromotion] corrupt project override JSON, rebuilding');
    }
  }
  const rules = override.customRules ?? [];
  const pattern = parsed.rule.pattern;
  const exists = rules.some(
    r =>
      r.toolName === parsed.rule.toolName &&
      (r.pattern ?? null) === (pattern ?? null) &&
      r.action === 'approve'
  );
  if (!exists) {
    override.customRules = [
      ...rules,
      {
        toolName: parsed.rule.toolName,
        ...(pattern ? { pattern } : {}),
        action: 'approve' as const,
      },
    ];
    db.prepare(
      'UPDATE projects SET agent_permission_override = ?, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(override), Date.now(), projectId);
  }
  return true;
}
