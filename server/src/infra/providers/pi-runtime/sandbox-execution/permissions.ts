import type { PermissionRequest } from '@zclaudia/shared/interaction/permissions';
import { formatGrantForDisplay } from './grants.js';
import type { SandboxEvidence, SandboxFailureClassification, SandboxGrant } from './types.js';

export const SANDBOX_CAPABILITY_ACCESS_TOOL = 'SandboxCapabilityAccess';
export const SANDBOX_UNSANDBOXED_ACCESS_TOOL = 'SandboxUnsandboxedAccess';
export const SANDBOX_NETWORK_ACCESS_COMPAT_TOOL = 'SandboxNetworkAccess';

export function buildSandboxCapabilityRequest(input: {
  requestId: string;
  commandPreview: string;
  grants: SandboxGrant[];
  classification: SandboxFailureClassification;
  evidence: SandboxEvidence;
}): PermissionRequest {
  const targets = input.grants.map(formatGrantForDisplay);
  const hosts = [...new Set(input.grants.map(grant => grant.host))];
  const inferred =
    input.classification === 'probable_sandbox_denial'
      ? ' This is inferred from incomplete evidence, not confirmed.'
      : '';
  // Disclose the true grant scope: the sandbox runtime enforces host-level
  // domain allow-lists, so approving http://host:port actually opens every
  // port and protocol on that host for the session (see grants.ts).
  return {
    requestId: input.requestId,
    toolName: SANDBOX_CAPABILITY_ACCESS_TOOL,
    toolInput: {
      grants: input.grants,
      classification: input.classification,
      evidence: input.evidence,
      command: input.commandPreview,
    },
    detail:
      `Allow sandboxed tool access to ${targets.join(', ')} for this session and rerun the operation.` +
      ` Note: network grants are host-scoped — approval opens all ports and protocols on ${hosts.join(', ')}, not only the URL shown.` +
      inferred,
    timeoutSeconds: 0,
    timeoutBehavior: 'deny',
  };
}

export function buildSandboxUnsandboxedRequest(input: {
  requestId: string;
  toolName: 'Bash' | 'Eval';
  commandPreview: string;
  privilegeReason: string;
  /** Set when the command also matched a critical-risk Bash pattern — the approver must see it. */
  criticalReason?: string;
}): PermissionRequest {
  return {
    requestId: input.requestId,
    toolName: SANDBOX_UNSANDBOXED_ACCESS_TOOL,
    toolInput: {
      originalToolName: input.toolName,
      command: input.commandPreview,
      privilegeReason: input.privilegeReason,
      ...(input.criticalReason ? { criticalReason: input.criticalReason } : {}),
    },
    detail:
      `The model is requesting host execution for this one ${input.toolName} call. ` +
      `Reason: ${input.privilegeReason}. This does not prove the previous failure was caused by sandbox policy.` +
      (input.criticalReason
        ? ` WARNING: this command also matched a critical-risk pattern (${input.criticalReason}).`
        : ''),
    timeoutSeconds: 0,
    timeoutBehavior: 'deny',
  };
}
