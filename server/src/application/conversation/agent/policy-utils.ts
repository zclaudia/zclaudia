/**
 * Permission policy utilities — normalization, merging, and database accessors.
 */
import type {
  CategoryAction,
  CategoryProfile,
  UnifiedPermissionPolicy,
  EvaluationContext,
} from '@zclaudia/shared/interaction/permissions';
import {
  DEFAULT_UNIFIED_POLICY,
  normalizeToUnifiedPolicy,
} from '@zclaudia/shared/interaction/permissions';

/** Resolve the active CategoryProfile from a policy */
export function resolveProfile(
  policy: UnifiedPermissionPolicy,
  _context?: EvaluationContext
): CategoryProfile {
  return policy.profile;
}

/**
 * Normalize a policy from the database. Always returns UnifiedPermissionPolicy.
 */
export function normalizePolicy(raw: unknown): UnifiedPermissionPolicy {
  if (!raw || typeof raw !== 'object') return DEFAULT_UNIFIED_POLICY;
  return normalizeToUnifiedPolicy(raw);
}

/**
 * Merge a project-level override into the global policy.
 */
export function mergePolicy(
  globalPolicy: UnifiedPermissionPolicy,
  projectOverride?: Partial<UnifiedPermissionPolicy> | null
): UnifiedPermissionPolicy {
  if (!projectOverride) return globalPolicy;

  const merged: UnifiedPermissionPolicy = {
    ...globalPolicy,
    profile: { ...globalPolicy.profile, ...projectOverride.profile },
    globalGuards: { ...globalPolicy.globalGuards, ...projectOverride.globalGuards },
    aiReview: { ...globalPolicy.aiReview, ...projectOverride.aiReview },
  };

  if (projectOverride.enabled !== undefined) merged.enabled = projectOverride.enabled;
  if (projectOverride.customRules !== undefined) merged.customRules = projectOverride.customRules;
  if (projectOverride.escalateAlways !== undefined)
    merged.escalateAlways = projectOverride.escalateAlways;

  return merged;
}

/**
 * Category actions ordered by restrictiveness: 'auto-approve' < 'ask' < 'block'.
 */
const CATEGORY_ACTION_RANK: Record<CategoryAction, number> = {
  'auto-approve': 0,
  ask: 1,
  block: 2,
};

function moreRestrictive(a: CategoryAction, b: CategoryAction): CategoryAction {
  return CATEGORY_ACTION_RANK[a] >= CATEGORY_ACTION_RANK[b] ? a : b;
}

/**
 * Intersect a sub-agent-inherited override into the effective policy (P2).
 *
 * Unlike {@link mergePolicy} — where the override wins outright — an inherited
 * override may only NARROW permissions, never widen them: a restriction the
 * parent effective policy already imposes (global policy + project override)
 * always survives in the sub-agent. Field semantics:
 *
 *   - `enabled`: AND (a disabled parent policy cannot be re-enabled);
 *   - `profile`: per-category most restrictive action wins
 *     (parent 'ask' + override 'auto-approve' → stays 'ask';
 *      parent 'ask' + override 'block' → 'block');
 *   - `globalGuards`: OR per flag (a guard on in either stays on);
 *   - `customRules`: parent rules keep precedence; only the override's
 *     narrowing rules (deny/escalate/continue) are appended — its 'approve'
 *     rules would widen and are dropped;
 *   - `escalateAlways`: union (the override can add, never remove);
 *   - `aiReview`: `enabled` ANDed, `confidenceThreshold`/`timeoutBeforeReview`
 *     take the max, `maxAutoApprovalsPerMinute` takes the min — so the
 *     override can only make AI auto-approval harder, never easier.
 */
export function narrowPolicy(
  parentPolicy: UnifiedPermissionPolicy,
  override?: Partial<UnifiedPermissionPolicy> | null
): UnifiedPermissionPolicy {
  if (!override) return parentPolicy;

  const profile: CategoryProfile = { ...parentPolicy.profile };
  if (override.profile) {
    for (const [category, action] of Object.entries(override.profile)) {
      const parentAction = profile[category as keyof CategoryProfile];
      if (parentAction && action) {
        profile[category as keyof CategoryProfile] = moreRestrictive(parentAction, action);
      }
    }
  }

  const narrowingRules = (override.customRules ?? []).filter(rule => rule.action !== 'approve');

  return {
    ...parentPolicy,
    enabled: parentPolicy.enabled && (override.enabled ?? true),
    profile,
    globalGuards: {
      blockSensitiveFiles:
        parentPolicy.globalGuards.blockSensitiveFiles ||
        (override.globalGuards?.blockSensitiveFiles ?? false),
      blockOutsideWorkspace:
        parentPolicy.globalGuards.blockOutsideWorkspace ||
        (override.globalGuards?.blockOutsideWorkspace ?? false),
    },
    customRules:
      override.customRules !== undefined
        ? [...parentPolicy.customRules, ...narrowingRules]
        : parentPolicy.customRules,
    escalateAlways: override.escalateAlways
      ? [...new Set([...parentPolicy.escalateAlways, ...override.escalateAlways])]
      : parentPolicy.escalateAlways,
    aiReview: override.aiReview
      ? {
          ...parentPolicy.aiReview,
          enabled: parentPolicy.aiReview.enabled && (override.aiReview.enabled ?? true),
          timeoutBeforeReview: Math.max(
            parentPolicy.aiReview.timeoutBeforeReview,
            override.aiReview.timeoutBeforeReview ?? parentPolicy.aiReview.timeoutBeforeReview
          ),
          confidenceThreshold: Math.max(
            parentPolicy.aiReview.confidenceThreshold,
            override.aiReview.confidenceThreshold ?? parentPolicy.aiReview.confidenceThreshold
          ),
          maxAutoApprovalsPerMinute: Math.min(
            parentPolicy.aiReview.maxAutoApprovalsPerMinute,
            override.aiReview.maxAutoApprovalsPerMinute ??
              parentPolicy.aiReview.maxAutoApprovalsPerMinute
          ),
        }
      : parentPolicy.aiReview,
  };
}

/**
 * Read agent permission policy from database (handles v1/v2/v3 formats, always returns v3).
 */
export function getAgentPermissionPolicy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- better-sqlite3 Statement.get() uses variadic params
  db: { prepare: (sql: string) => { get: (...args: any[]) => Record<string, unknown> | undefined } }
): UnifiedPermissionPolicy | null {
  try {
    const row = db.prepare('SELECT permission_policy FROM agent_config WHERE id = 1').get() as
      | { permission_policy: string | null }
      | undefined;

    if (!row?.permission_policy) return null;

    const raw = JSON.parse(row.permission_policy);
    return normalizePolicy(raw);
  } catch {
    return null;
  }
}

/**
 * Read project-level agent permission override from database.
 */
export function getProjectPermissionOverride(
  db: {
    prepare: (sql: string) => { get: (...args: any[]) => Record<string, unknown> | undefined };
  },
  projectId: string
): Partial<UnifiedPermissionPolicy> | null {
  try {
    const row = db
      .prepare('SELECT agent_permission_override FROM projects WHERE id = ?')
      .get(projectId) as { agent_permission_override: string | null } | undefined;

    if (!row?.agent_permission_override) return null;

    const raw = JSON.parse(row.agent_permission_override);
    return raw as Partial<UnifiedPermissionPolicy>;
  } catch {
    return null;
  }
}
