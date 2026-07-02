/**
 * Permission policy utilities — normalization, merging, and database accessors.
 */
import type {
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
