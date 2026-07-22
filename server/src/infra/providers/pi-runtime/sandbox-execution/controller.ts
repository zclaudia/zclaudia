import type { PermissionCallback } from '../../message-types.js';
import { classifySandboxFailure } from './classifier.js';
import { buildSandboxCapabilityRequest, buildSandboxUnsandboxedRequest } from './permissions.js';
import type { SandboxExecutionDetails, SandboxGrant, SandboxPrivilegeMode } from './types.js';

export interface SandboxOperationResult {
  ok: boolean;
  sandboxed: boolean;
  outputText: string;
  exitCode?: number | null;
  timedOut?: boolean;
}

export interface SandboxEscalationInput {
  toolCallId: string;
  toolName: 'Bash' | 'Eval';
  sourceText: string;
  allowedDomains: ReadonlySet<string>;
  sandboxMode: SandboxPrivilegeMode;
  privilegeReason?: string;
  /**
   * When the command matched a critical-risk Bash pattern, carry the match
   * reason into any unsandboxed approval request so the approver sees it.
   */
  criticalReason?: string;
  operation: (grants: SandboxGrant[]) => Promise<SandboxOperationResult>;
  unsandboxedOperation?: () => Promise<SandboxOperationResult>;
  permissionCallback?: PermissionCallback;
  persistGrant?: (grant: SandboxGrant) => void;
}

export interface SandboxEscalationOutput {
  result: SandboxOperationResult;
  details: SandboxExecutionDetails;
}

function internalProxyDetails(
  internalProxyUrls: string[] | undefined
): Pick<SandboxExecutionDetails, 'sandboxInternalProxyDetected' | 'sandboxInternalProxyUrls'> {
  if (!internalProxyUrls?.length) return {};
  return {
    sandboxInternalProxyDetected: true,
    sandboxInternalProxyUrls: internalProxyUrls,
  };
}

function missingReason(toolName: 'Bash' | 'Eval'): SandboxEscalationOutput {
  return {
    result: {
      ok: false,
      sandboxed: true,
      outputText: `${toolName} sandbox_mode=unsandboxed failed: privilege_reason is required.`,
    },
    details: {
      sandboxed: true,
      privilegeMode: 'sandbox',
      failureClassification: 'not_sandbox_denial',
      recommendedNextStep: 'Retry with privilege_reason explaining why host execution is necessary.',
    },
  };
}

function derivedUnsandboxedReason(input: SandboxEscalationInput, details: SandboxExecutionDetails): string {
  return (
    input.privilegeReason?.trim() ||
    details.recommendedNextStep ||
    `Sandboxed ${input.toolName} failed on a host-only operation that requires one-shot host execution.`
  );
}

function preflightHostOnlyReason(input: SandboxEscalationInput): string | undefined {
  if (input.toolName !== 'Bash') return undefined;
  const source = input.sourceText;
  if (
    /\buvicorn\b/i.test(source) &&
    /(?:--host\s+(?:127\.0\.0\.1|localhost)|--port\s+\d+)/i.test(source)
  ) {
    return 'Starting a localhost-bound uvicorn server requires host port binding, which the sandbox cannot provide.';
  }
  if (
    /\b(?:python(?:3)?\s+-m\s+http\.server|vite\b|next\s+dev\b|flask\s+run\b|rails\s+server\b|npm\s+run\s+dev\b|pnpm\s+(?:dev|start)\b|yarn\s+(?:dev|start)\b)/i.test(
      source
    ) &&
    /(?:localhost|127\.0\.0\.1|--host|--port|-p\s+\d+|\bPORT=)/i.test(source)
  ) {
    return 'Starting a localhost-bound development server requires host port binding, which the sandbox cannot provide.';
  }
  if (/\baws\b/i.test(source) && /\b(?:sso|credential|credentials|sts)\b/i.test(source)) {
    return 'AWS SSO and credential commands depend on host credential/browser state and should run as one-shot host execution.';
  }
  if (/(?:^|[\s;|&])adb\s/i.test(source)) {
    return 'adb needs the host adb server and USB/emulator device access, which the sandbox cannot provide.';
  }
  if (/(?:^|[\s;|&])xcodebuild\s/i.test(source)) {
    return 'xcodebuild depends on the host Xcode toolchain, signing certificates, and keychain, which the sandbox cannot provide.';
  }
  return undefined;
}

async function requestUnsandboxed(input: SandboxEscalationInput): Promise<SandboxEscalationOutput> {
  if (!input.privilegeReason?.trim()) return missingReason(input.toolName);
  if (!input.permissionCallback || !input.unsandboxedOperation) {
    return {
      result: {
        ok: false,
        sandboxed: true,
        outputText: 'Unsandboxed execution requires a permission channel and host operation.',
      },
      details: {
        sandboxed: true,
        privilegeMode: 'sandbox',
        failureClassification: 'not_sandbox_denial',
        recommendedNextStep: 'Run without unsandboxed mode or provide a permission channel.',
      },
    };
  }
  const decision = await input.permissionCallback(
    buildSandboxUnsandboxedRequest({
      requestId: `${input.toolCallId}:unsandboxed`,
      toolName: input.toolName,
      commandPreview: input.sourceText,
      privilegeReason: input.privilegeReason,
      criticalReason: input.criticalReason,
    })
  );
  if (decision.behavior !== 'allow') {
    return {
      result: {
        ok: false,
        sandboxed: true,
        outputText: decision.message ?? 'Unsandboxed execution denied.',
      },
      details: {
        sandboxed: true,
        privilegeMode: 'sandbox',
        escalationRequested: true,
        unsandboxedApproved: false,
      },
    };
  }
  const result = await input.unsandboxedOperation();
  return {
    result,
    details: {
      sandboxed: false,
      privilegeMode: 'unsandboxed',
      escalationRequested: true,
      unsandboxedApproved: true,
    },
  };
}

export async function runSandboxedWithEscalation(
  input: SandboxEscalationInput
): Promise<SandboxEscalationOutput> {
  if (input.sandboxMode === 'unsandboxed') {
    return requestUnsandboxed(input);
  }

  const preflightReason = input.sandboxMode === 'auto' ? preflightHostOnlyReason(input) : undefined;
  if (preflightReason) {
    return requestUnsandboxed({
      ...input,
      privilegeReason: input.privilegeReason?.trim() || preflightReason,
    });
  }

  const first = await input.operation([]);
  if (first.ok) {
    return {
      result: first,
      details: { sandboxed: first.sandboxed, privilegeMode: 'sandbox' },
    };
  }

  const classified = classifySandboxFailure({
    toolName: input.toolName,
    sourceText: input.sourceText,
    outputText: first.outputText,
    sandboxed: first.sandboxed,
    exitCode: first.exitCode,
    timedOut: first.timedOut,
    allowedDomains: input.allowedDomains,
  });

  const baseDetails: SandboxExecutionDetails = {
    sandboxed: first.sandboxed,
    privilegeMode: 'sandbox',
    failureClassification: classified.classification,
    sandboxEvidence: classified.evidence,
    recommendedPrivilegeMode: classified.recommendedPrivilegeMode,
    recommendedNextStep: classified.recommendedNextStep,
    ...internalProxyDetails(classified.evidence.internalProxyUrls),
  };

  if (
    classified.classification === 'confirmed_sandbox_denial' &&
    classified.recommendedPrivilegeMode === 'unsandboxed' &&
    input.sandboxMode !== 'sandbox'
  ) {
    const unsandboxed = await requestUnsandboxed({
      ...input,
      privilegeReason: derivedUnsandboxedReason(input, baseDetails),
    });
    return {
      result: unsandboxed.result,
      details: {
        ...baseDetails,
        ...unsandboxed.details,
        escalationRequested: true,
      },
    };
  }

  if (
    classified.classification !== 'confirmed_sandbox_denial' ||
    input.sandboxMode === 'sandbox' ||
    classified.candidateGrants.length === 0
  ) {
    return { result: first, details: baseDetails };
  }

  if (!input.permissionCallback) {
    return {
      result: {
        ok: false,
        sandboxed: first.sandboxed,
        outputText: 'Sandbox capability access is required, but no permission channel is available.',
        exitCode: first.exitCode,
      },
      details: {
        ...baseDetails,
        escalationRequested: true,
        recommendedNextStep: 'Retry when a permission channel is available.',
      },
    };
  }

  const decision = await input.permissionCallback(
    buildSandboxCapabilityRequest({
      requestId: `${input.toolCallId}:capability:0`,
      commandPreview: input.sourceText,
      grants: classified.candidateGrants,
      classification: classified.classification,
      evidence: classified.evidence,
    })
  );
  if (decision.behavior !== 'allow') {
    return {
      result: first,
      details: { ...baseDetails, escalationRequested: true },
    };
  }

  for (const grant of classified.candidateGrants) input.persistGrant?.(grant);
  const retry = await input.operation(classified.candidateGrants);
  return {
    result: retry,
    details: {
      sandboxed: retry.sandboxed,
      privilegeMode: 'capability-granted',
      grantsUsed: classified.candidateGrants,
      escalationRequested: true,
      failureClassification: retry.ok ? undefined : classified.classification,
      sandboxEvidence: retry.ok ? undefined : classified.evidence,
      ...internalProxyDetails(classified.evidence.internalProxyUrls),
    },
  };
}
