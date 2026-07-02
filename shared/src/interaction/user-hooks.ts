import { parseToolRule } from './tool-rule-syntax.js';

export type UserHookEvent = 'PreToolUse' | 'PostToolUse';

export interface UserHookDefinition {
  event: UserHookEvent;
  /** Tool(pattern) syntax (e.g. `Bash(git *)`); absent = matches every tool. */
  matcher?: string;
  /** Shell command, executed with cwd = workspace root. */
  command: string;
  /** Per-hook timeout. Default 10_000, clamped to [1_000, 60_000]. */
  timeoutMs?: number;
  /** Default true. */
  enabled?: boolean;
}

export const DEFAULT_HOOK_TIMEOUT_MS = 10_000;
export const MIN_HOOK_TIMEOUT_MS = 1_000;
export const MAX_HOOK_TIMEOUT_MS = 60_000;

export function clampHookTimeout(ms: number | undefined): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_HOOK_TIMEOUT_MS;
  return Math.min(Math.max(ms, MIN_HOOK_TIMEOUT_MS), MAX_HOOK_TIMEOUT_MS);
}

/** Validate an unknown JSON value into a hook list; invalid entries dropped with reasons. */
export function parseUserHooks(raw: unknown): { hooks: UserHookDefinition[]; warnings: string[] } {
  const hooks: UserHookDefinition[] = [];
  const warnings: string[] = [];
  if (raw == null) return { hooks, warnings };
  if (!Array.isArray(raw)) {
    warnings.push('hooks config is not an array');
    return { hooks, warnings };
  }
  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      warnings.push(`hook[${i}]: not an object`);
      return;
    }
    const h = entry as Record<string, unknown>;
    if (h.event !== 'PreToolUse' && h.event !== 'PostToolUse') {
      warnings.push(`hook[${i}]: invalid event`);
      return;
    }
    if (typeof h.command !== 'string' || !h.command.trim()) {
      warnings.push(`hook[${i}]: missing command`);
      return;
    }
    if (h.matcher !== undefined) {
      if (typeof h.matcher !== 'string') {
        warnings.push(`hook[${i}]: matcher must be a string`);
        return;
      }
      const parsed = parseToolRule(h.matcher);
      if (!parsed.ok) {
        warnings.push(`hook[${i}]: invalid matcher: ${parsed.error}`);
        return;
      }
    }
    hooks.push({
      event: h.event,
      ...(typeof h.matcher === 'string' ? { matcher: h.matcher } : {}),
      command: h.command,
      ...(h.timeoutMs !== undefined ? { timeoutMs: clampHookTimeout(h.timeoutMs as number) } : {}),
      ...(h.enabled === false ? { enabled: false } : {}),
    });
  });
  return { hooks, warnings };
}

/**
 * Rule-vs-toolcall matching, same semantics as the permission evaluator's
 * custom rules: exact or '*' tool name; pattern (if any) regex-tested
 * case-insensitively against the human detail; invalid regex never matches.
 */
export function matchesToolRule(
  rule: { toolName: string; pattern?: string },
  toolName: string,
  detail: string
): boolean {
  if (rule.toolName !== '*' && rule.toolName !== toolName) return false;
  if (!rule.pattern) return true;
  try {
    return new RegExp(rule.pattern, 'i').test(detail);
  } catch {
    return false;
  }
}
