import type {
  AgentPermissionRule,
  CategoryAction,
  CategoryProfile,
  PermissionCategory,
  EvaluationContext,
  UnifiedPermissionPolicy,
} from '@zclaudia/shared/interaction/permissions';
import type { McpRiskAction, McpServerTrustPolicy } from '@zclaudia/shared/core/mcp';
import {
  DEFAULT_SENSITIVE_PATTERNS,
} from '@zclaudia/shared/interaction/permissions';
import * as path from 'path';
import { minimatch } from 'minimatch';

import {
  extractPathsFromCommand,
  isPathWithinRoot,
  normalizeExternalRoot,
  extractRememberableShellCommands,
  splitCompoundCommand,
} from './shell-parser.js';

import { resolveProfile } from './policy-utils.js';

// ============================================
// Re-exports (preserve public API)
// ============================================

export type { ShellToken } from './shell-parser.js';
export {
  tokenizeShellWords,
  getCommandSignature,
  shouldSkipTokenAsTextArgument,
  shouldIgnoreOutsideWorkspaceExecutable,
  extractPathsFromCommand,
  isPathWithinRoot,
  normalizeExternalRoot,
  splitCompoundCommand,
  extractCommandSubstitutions,
  normalizeRememberableShellFragment,
  unwrapGroupedFragment,
  extractFindExecCommands,
  extractXargsCommands,
  extractShellWrapperCommands,
  extractHeredocCommands,
  extractParallelCommands,
  extractRememberableShellCommands,
} from './shell-parser.js';

export type {
  PermissionMemoryRow,
  PermissionMemoryDb,
  OutsideWorkspaceMemoryRow,
} from './permission-memory.js';
export {
  loadSessionRememberedDecisions,
  persistSessionRememberedDecision,
  loadProjectAllowedOutsideWorkspaceRoots,
  persistProjectAllowedOutsideWorkspaceRoots,
} from './permission-memory.js';

export {
  resolveProfile,
  normalizePolicy,
  mergePolicy,
  getAgentPermissionPolicy,
  getProjectPermissionOverride,
} from './policy-utils.js';

// ============================================
// Types
// ============================================

export type EvaluationResult = 'approve' | 'deny' | 'escalate';
export type RememberedDecision = 'allow' | 'deny';
export type MatchedPermissionRule =
  | 'Always escalate'
  | 'Custom rule'
  | 'Sensitive file access'
  | 'Outside workspace access'
  | 'Category: fileRead'
  | 'Category: fileWrite'
  | 'Category: shellSafe'
  | 'Category: networkOps'
  | 'Category: destructiveOps'
  | 'Category: userQuestions';

// ============================================
// Shared Utilities
// ============================================

/** Extract file_path from toolInput (used by Write, Edit, Read, etc.) */
function extractFilePath(toolInput: unknown): string | null {
  if (toolInput && typeof toolInput === 'object' && 'file_path' in toolInput) {
    const fp = (toolInput as { file_path: unknown }).file_path;
    if (typeof fp === 'string') return fp;
  }
  return null;
}

/** Extract Bash command from toolInput or detail */
export function extractBashCommand(toolInput: unknown, detail: string): string | null {
  const normalizeCommandText = (value: string): string => {
    return value
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  };

  if (toolInput && typeof toolInput === 'object' && 'command' in toolInput) {
    const cmd = (toolInput as { command: unknown }).command;
    if (typeof cmd === 'string') return normalizeCommandText(cmd);
  }
  if (detail) return normalizeCommandText(detail);
  return null;
}

export function isBashLikeTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower === 'bash'
    || lower === 'execute_command'
    || lower === 'run_terminal_cmd'
    || lower === 'terminal'
    || lower === 'agent_shell';
}

function hasToolNameSuffix(toolName: string, suffix: string): boolean {
  return toolName === suffix
    || toolName.endsWith(`_${suffix}`)
    || toolName.endsWith(`-${suffix}`)
    || toolName.endsWith(`:${suffix}`);
}

export function isInternalInteractionTool(toolName: string): boolean {
  return hasToolNameSuffix(toolName, 'update_todo_list')
    || hasToolNameSuffix(toolName, 'ask_user_form')
    || hasToolNameSuffix(toolName, 'request_approval')
    || hasToolNameSuffix(toolName, 'push_file')
    || hasToolNameSuffix(toolName, 'enter_plan_mode')
    || hasToolNameSuffix(toolName, 'exit_plan_mode')
    || toolName === 'EnterPlanMode';
}

function isBlockingInteractionTool(toolName: string): boolean {
  return hasToolNameSuffix(toolName, 'ask_user_form')
    || hasToolNameSuffix(toolName, 'request_approval')
    || hasToolNameSuffix(toolName, 'exit_plan_mode')
    || toolName === 'ExitPlanMode';
}

// ============================================
// Outside Workspace Path Analysis
// ============================================

export function getOutsideWorkspacePaths(
  toolName: string,
  toolInput: unknown,
  detail: string,
  rootPath: string
): string[] {
  if (!rootPath) return [];

  const paths: string[] = [];
  const filePath = extractFilePath(toolInput);
  if (filePath && !isPathWithinRoot(filePath, rootPath)) {
    paths.push(path.resolve(filePath));
  }

  if (isBashLikeTool(toolName)) {
    const command = extractBashCommand(toolInput, detail);
    if (command) {
      for (const p of extractPathsFromCommand(command)) {
        // Bash commands run cwd'd to the workspace root, so resolve relative
        // paths against rootPath (not process.cwd()) before the within-root test.
        const abs = path.isAbsolute(p) ? p : path.resolve(rootPath, p);
        if (!isPathWithinRoot(abs, rootPath)) {
          paths.push(abs);
        }
      }
    }
  }

  return [...new Set(paths)];
}

export function getOutsideWorkspaceRootsToRemember(
  toolName: string,
  toolInput: unknown,
  detail: string,
  rootPath: string
): string[] {
  return getOutsideWorkspacePaths(toolName, toolInput, detail, rootPath)
    .map((filePath) => normalizeExternalRoot(filePath))
    .filter((dir, index, arr) => arr.indexOf(dir) === index);
}

export function isOutsideWorkspacePathAllowed(
  toolName: string,
  toolInput: unknown,
  detail: string,
  rootPath: string,
  allowedRoots: Iterable<string>
): boolean {
  const outsidePaths = getOutsideWorkspacePaths(toolName, toolInput, detail, rootPath);
  if (outsidePaths.length === 0) return false;
  const roots = [...allowedRoots].map((root) => path.resolve(root));
  return outsidePaths.every((outsidePath) => (
    roots.some((root) => isPathWithinRoot(outsidePath, root))
  ));
}

// ============================================
// Tool Categories
// ============================================

const READONLY_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
  'ToolSearch',
  'ListMcpResources',
  'ReadMcpResource',
  'TaskOutput',
  'LSPTool',
];

const EDIT_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+(-[a-z]*f|-[a-z]*r|--force|--recursive)\b/i,
  /\brm\s+-rf\b/i,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/i,
  /\bformat\b/i,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\bgit\s+push\s+(-f|--force)\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bchmod\s+777\b/,
  /\bchown\b.*-R\b/,
  />\s*\/dev\/sd[a-z]/,
  /\bcurl\b.*\|\s*(ba)?sh\b/,
  /\bwget\b.*\|\s*(ba)?sh\b/,
];

const NETWORK_BASH_PATTERNS = [
  /\bcurl\b/,
  /\bwget\b/,
  /\bssh\b/,
  /\bscp\b/,
  /\brsync\b.*:/,
  /\bnpm\s+publish\b/,
  /\byarn\s+publish\b/,
  /\bgit\s+push\b/,
  /\bgit\s+fetch\b/,
  /\bgit\s+pull\b/,
  /\bgit\s+clone\b/,
  /\bdocker\s+push\b/,
  /\bdocker\s+pull\b/,
  /\bnc\b/,
  /\btelnet\b/,
];

// ============================================
// Internal Guard Checks
// ============================================

function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return DEFAULT_SENSITIVE_PATTERNS.some(p => minimatch(basename, p, { dot: true }));
}

function targetsSensitiveFile(toolName: string, toolInput: unknown, detail: string): boolean {
  const filePath = extractFilePath(toolInput);
  if (filePath && isSensitiveFile(filePath)) return true;

  if (isBashLikeTool(toolName)) {
    const command = extractBashCommand(toolInput, detail);
    if (command) {
      return extractPathsFromCommand(command).some(p => isSensitiveFile(p));
    }
  }
  return false;
}

function targetsOutsideWorkspace(toolName: string, toolInput: unknown, detail: string, rootPath: string): boolean {
  if (!rootPath) return false;

  const filePath = extractFilePath(toolInput);
  if (filePath && !isPathWithinRoot(filePath, rootPath)) return true;

  if (isBashLikeTool(toolName)) {
    const command = extractBashCommand(toolInput, detail);
    if (command) {
      return extractPathsFromCommand(command).some(p => {
        // Bash commands run cwd'd to the workspace root, so resolve relative
        // paths against rootPath (not process.cwd()) before the within-root test.
        const abs = path.isAbsolute(p) ? p : path.resolve(rootPath, p);
        return !isPathWithinRoot(abs, rootPath);
      });
    }
  }
  return false;
}

function isNetworkCommand(toolInput: unknown, detail: string): boolean {
  const command = extractBashCommand(toolInput, detail);
  if (!command) return false;
  return NETWORK_BASH_PATTERNS.some(p => p.test(command));
}

function isDangerousCommand(toolInput: unknown, detail: string): boolean {
  const command = extractBashCommand(toolInput, detail);
  if (!command) return true; // No command = can't verify safety = escalate
  return DANGEROUS_BASH_PATTERNS.some(p => p.test(command));
}

// ============================================
// Tool Classification
// ============================================

/** Classify a tool call into a permission category */
export function classify(toolName: string, toolInput: unknown, detail: string): PermissionCategory {
  if (toolName === 'AskUserQuestion') return 'userQuestions';
  if (isBlockingInteractionTool(toolName)) return 'userQuestions';
  // Memory only mutates its own per-project directory (path safety enforced
  // inside the tool) — treat as fileRead so default profiles auto-approve.
  if (toolName === 'Memory') return 'fileRead';
  if (READONLY_TOOLS.includes(toolName)) return 'fileRead';
  if (EDIT_TOOLS.includes(toolName)) return 'fileWrite';
  if (toolName.startsWith('mcp__')) return 'networkOps';

  if (isBashLikeTool(toolName)) {
    if (isDangerousCommand(toolInput, detail)) return 'destructiveOps';
    if (isNetworkCommand(toolInput, detail)) return 'networkOps';
    return 'shellSafe';
  }

  // Task tool and other unknown tools → shellSafe (custom rules can override)
  return 'shellSafe';
}

/** Map a CategoryAction to an EvaluationResult */
function actionToResult(action: CategoryAction): EvaluationResult {
  switch (action) {
    case 'auto-approve': return 'approve';
    case 'ask': return 'escalate';
    case 'block': return 'deny';
  }
}

function mcpRiskActionToResult(action: McpRiskAction): EvaluationResult {
  switch (action) {
    case 'auto-approve': return 'approve';
    case 'ask': return 'escalate';
    case 'deny': return 'deny';
  }
}

export function evaluateMcpToolTrustPolicy(
  risk: { riskLevel?: 'low' | 'medium' | 'high'; declaredReadOnly?: boolean },
  policy?: McpServerTrustPolicy,
): EvaluationResult {
  const riskLevel = risk.riskLevel ?? 'high';
  const action = policy?.riskActions?.[riskLevel];
  if (action) return mcpRiskActionToResult(action);

  if (
    risk.declaredReadOnly === true
    && policy?.trustReadOnlyHint === true
    && (policy.trustLevel === 'trusted-readonly' || policy.trustLevel === 'trusted')
  ) {
    return 'approve';
  }

  return mcpRiskActionToResult(policy?.defaultRiskAction ?? 'ask');
}

// ============================================
// Remember Key Builder
// ============================================

/** Build stable remember keys for a tool call. */
export function buildRememberKeys(toolName: string, toolInput: unknown, detail: string): string[] {
  if (!isBashLikeTool(toolName)) {
    return [toolName];
  }

  const cmd = extractBashCommand(toolInput, detail);
  if (!cmd) {
    return ['Bash'];
  }

  const normalized = cmd.trim();
  const keys = [`Bash:${normalized}`];
  for (const segment of extractRememberableShellCommands(normalized)) {
    keys.push(`Bash:${segment}`);
  }

  return [...new Set(keys)];
}

/** Backward-compatible single remember key accessor. */
export function buildRememberKey(toolName: string, toolInput: unknown, detail: string): string {
  return buildRememberKeys(toolName, toolInput, detail)[0];
}

export function resolveRememberedDecision(
  lookup: Pick<Map<string, RememberedDecision>, 'get'>,
  toolName: string,
  toolInput: unknown,
  detail: string
): RememberedDecision | null {
  return lookup.get(buildRememberKey(toolName, toolInput, detail)) ?? null;
}

// ============================================
// Matched Permission Rule
// ============================================

export function getMatchedPermissionRule(
  toolName: string,
  toolInput: unknown,
  detail: string,
  policy: UnifiedPermissionPolicy,
  context?: EvaluationContext
): MatchedPermissionRule | null {
  if (!policy.enabled) return null;

  const rootPath = context?.rootPath || process.cwd();
  const customRules = policy.customRules || [];

  if (policy.escalateAlways?.includes(toolName)) {
    return 'Always escalate';
  }

  // Deny-action custom rules checked before guards (deny is strongest)
  const denyResult = evaluateCustomRules(toolName, detail, customRules.filter(r => r.action === 'deny'));
  if (denyResult === 'deny') {
    return 'Custom rule';
  }

  if (policy.globalGuards.blockSensitiveFiles && targetsSensitiveFile(toolName, toolInput, detail)) {
    return 'Sensitive file access';
  }

  if (policy.globalGuards.blockOutsideWorkspace && targetsOutsideWorkspace(toolName, toolInput, detail, rootPath)) {
    return 'Outside workspace access';
  }

  // Remaining custom rules (approve / escalate / continue)
  const customResult = evaluateCustomRules(toolName, detail, customRules.filter(r => r.action !== 'deny'));
  if (customResult === 'escalate') {
    return 'Custom rule';
  }

  const category = classify(toolName, toolInput, detail);
  if (resolveProfile(policy, context)[category] === 'ask') {
    return `Category: ${category}`;
  }

  return null;
}

// ============================================
// Custom Rules Evaluator
// ============================================

type CustomRuleResult = 'approve' | 'deny' | 'escalate' | 'continue';

function evaluateCustomRules(toolName: string, detail: string, rules: AgentPermissionRule[]): CustomRuleResult {
  for (const rule of rules) {
    if (rule.toolName === '*' || rule.toolName === toolName) {
      if (rule.pattern) {
        try {
          const re = new RegExp(rule.pattern, 'i');
          if (re.test(detail)) return rule.action;
        } catch {
          continue;
        }
      } else {
        return rule.action;
      }
    }
  }
  return 'continue';
}

// ============================================
// Category-Based Permission Evaluator
// ============================================

/**
 * Permission evaluator — unified single-profile evaluation.
 *
 * Evaluation order:
 *   1. escalateAlways list
 *   2. Deny-action custom rules (first match wins)
 *      Deny rules are strongest — they are never weakened to a prompt by a guard.
 *   3. Global guards (sensitive files / outside workspace → escalate)
 *      Guards stop allow/escalate rules from bypassing protection; they cannot
 *      override an explicit deny.
 *   4. Remaining custom rules — approve / escalate / continue (first match wins)
 *   5. Classify tool → category → look up profile → action
 */
export class PermissionEvaluator {
  evaluate(
    toolName: string,
    toolInput: unknown,
    detail: string,
    policy: UnifiedPermissionPolicy,
    context?: EvaluationContext
  ): EvaluationResult {
    if (!policy.enabled) return 'escalate';

    const rootPath = context?.rootPath || process.cwd();
    const customRules = policy.customRules || [];

    // 1. escalateAlways
    if (policy.escalateAlways?.includes(toolName)) {
      return 'escalate';
    }

    // 2. Deny-action custom rules — strongest signal, never weakened by a guard
    const denyResult = evaluateCustomRules(toolName, detail, customRules.filter(r => r.action === 'deny'));
    if (denyResult === 'deny') {
      return 'deny';
    }

    // 3. Global guards → escalate (stop allow rules from bypassing protection)
    if (policy.globalGuards.blockSensitiveFiles && targetsSensitiveFile(toolName, toolInput, detail)) {
      return 'escalate';
    }
    if (policy.globalGuards.blockOutsideWorkspace && targetsOutsideWorkspace(toolName, toolInput, detail, rootPath)) {
      return 'escalate';
    }

    // 4. Remaining custom rules — approve / escalate / continue (first match wins)
    const customResult = evaluateCustomRules(toolName, detail, customRules.filter(r => r.action !== 'deny'));
    if (customResult !== 'continue') {
      return customResult;
    }

    // 5. Category-based evaluation
    const category = classify(toolName, toolInput, detail);
    const action = resolveProfile(policy, context)[category];

    return actionToResult(action);
  }
}
