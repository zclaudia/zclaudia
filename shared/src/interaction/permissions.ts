// Permission Types

import type { SessionType } from '../core/session.js';

export type PermissionDecision = 'allow' | 'deny' | 'timeout';

export interface PermissionLog {
  id: string;
  sessionId: string;
  tool: string;
  detail: string;
  decision: PermissionDecision;
  remembered: boolean;
  createdAt: number;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: unknown;
  detail: string;
  timeoutSeconds: number;
  /** What to do when the timeout expires. Defaults to 'deny'. */
  timeoutBehavior?: 'approve' | 'deny';
}

// ============================================
// Agent Permission Policy Types
// ============================================

export interface AgentPermissionRule {
  toolName: string;      // exact match or '*'
  pattern?: string;      // optional regex on detail
  action: 'approve' | 'deny' | 'escalate' | 'continue';
}

/** The six operation categories for permission evaluation */
export type PermissionCategory = 'fileRead' | 'fileWrite' | 'shellSafe' | 'networkOps' | 'destructiveOps' | 'userQuestions';

/** Per-category action */
export type CategoryAction = 'auto-approve' | 'ask' | 'block';

/** One session profile: maps each category to an action */
export type CategoryProfile = Record<PermissionCategory, CategoryAction>;

/** Global guard toggles (always checked regardless of category) */
export interface GlobalGuards {
  blockSensitiveFiles: boolean;   // .env, .ssh, credentials → escalate
  blockOutsideWorkspace: boolean; // Outside workspace → escalate
}

// ============================================
// Unified Permission Policy
// ============================================

/** Result of an AI review for an escalated permission request */
export interface AIReviewMetadata {
  payloadDisposition?: 'safe_to_send' | 'send_with_redaction' | 'do_not_send';
  redactionCount?: number;
  reviewedFileCount?: number;
}

export interface AIReviewResult {
  decision: 'approve' | 'deny' | 'uncertain';
  reasoning: string;
  confidence: number;
  metadata?: AIReviewMetadata;
}

/** AI review configuration for blacklisted/escalated commands */
export interface AIReviewConfig {
  enabled: boolean;
  /** Seconds to wait for user before triggering AI review. Default 60. */
  timeoutBeforeReview: number;
  /** Confidence threshold (0-1). Below this, keep waiting for user. Default 0.8 */
  confidenceThreshold: number;
  /** Rate limit: max auto-approvals per minute. Default 10 */
  maxAutoApprovalsPerMinute: number;
  /** Provider for LLM risk analysis (optional, uses default if not set) */
  analysisProviderId?: string;
}

/** Unified permission policy — single profile for all session types */
export interface UnifiedPermissionPolicy {
  enabled: boolean;

  /** Single profile applied to ALL session types */
  profile: CategoryProfile;

  globalGuards: GlobalGuards;

  /** Custom rules (first-match override, same as before) */
  customRules: AgentPermissionRule[];

  /** Tools that always escalate to user (interactive tools, no AI review) */
  escalateAlways: string[];

  /** AI review configuration for escalated commands on timeout */
  aiReview: AIReviewConfig;
}

export const DEFAULT_AI_REVIEW_CONFIG: AIReviewConfig = {
  enabled: true,
  timeoutBeforeReview: 60,
  confidenceThreshold: 0.8,
  maxAutoApprovalsPerMinute: 10,
};

export const DEFAULT_UNIFIED_PROFILE: CategoryProfile = {
  fileRead: 'auto-approve',
  fileWrite: 'auto-approve',
  shellSafe: 'auto-approve',
  networkOps: 'auto-approve',
  destructiveOps: 'ask',
  userQuestions: 'ask',
};

export const DEFAULT_GLOBAL_GUARDS: GlobalGuards = {
  blockSensitiveFiles: true,
  blockOutsideWorkspace: false,
};

export const DEFAULT_UNIFIED_POLICY: UnifiedPermissionPolicy = {
  enabled: true,
  profile: DEFAULT_UNIFIED_PROFILE,
  globalGuards: DEFAULT_GLOBAL_GUARDS,
  customRules: [],
  // Only generic, provider-agnostic tool names live in the shared default.
  // Provider-specific always-escalate tools (e.g. Claude's ExitPlanMode) come
  // from each provider's policy (`escalateAlwaysTools`) and are unioned
  // into the effective policy at evaluation time.
  escalateAlways: ['AskUserQuestion'],
  aiReview: DEFAULT_AI_REVIEW_CONFIG,
};

function cloneUnifiedPolicy(policy: UnifiedPermissionPolicy): UnifiedPermissionPolicy {
  return {
    enabled: policy.enabled,
    profile: { ...policy.profile },
    globalGuards: { ...policy.globalGuards },
    customRules: [...policy.customRules],
    escalateAlways: [...policy.escalateAlways],
    aiReview: { ...policy.aiReview },
  };
}


/**
 * Ensure AskUserQuestion is present in the escalateAlways list. Provider-
 * specific tools (e.g. plan-mode submissions) are NOT added here — those
 * live on each provider's policy (`escalateAlwaysTools`) and get
 * unioned in at evaluation time.
 */
export function ensureEscalateAlways(list?: string[]): string[] {
  const result = [...(list || [])];
  if (!result.includes('AskUserQuestion')) result.push('AskUserQuestion');
  return result;
}

/**
 * Normalize a raw policy object to UnifiedPermissionPolicy, filling in defaults.
 */
export function normalizeToUnifiedPolicy(raw: unknown): UnifiedPermissionPolicy {
  if (!raw || typeof raw !== 'object') return cloneUnifiedPolicy(DEFAULT_UNIFIED_POLICY);

  const policy = raw as Partial<UnifiedPermissionPolicy>;
  return {
    enabled: policy.enabled ?? true,
    profile: { ...DEFAULT_UNIFIED_PROFILE, ...policy.profile },
    globalGuards: { ...DEFAULT_GLOBAL_GUARDS, ...policy.globalGuards },
    customRules: policy.customRules || [],
    escalateAlways: ensureEscalateAlways(policy.escalateAlways),
    aiReview: { ...DEFAULT_AI_REVIEW_CONFIG, ...policy.aiReview },
  };
}

/** Context passed to the permission evaluator for path-aware evaluation */
export interface EvaluationContext {
  rootPath: string;              // Session's workspace root directory
  sessionType?: SessionType;     // Optional, no longer used for profile lookup
}

/** Default sensitive file patterns */
export const DEFAULT_SENSITIVE_PATTERNS = [
  '.env*',
  '*credential*',
  '*.pem',
  '*.key',
  'id_rsa*',
  '*.p12',
  '*.pfx',
  '*secret*',
];
