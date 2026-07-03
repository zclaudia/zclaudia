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
  operation: (grants: SandboxGrant[]) => Promise<SandboxOperationResult>;
  unsandboxedOperation?: () => Promise<SandboxOperationResult>;
  permissionCallback?: PermissionCallback;
  persistGrant?: (grant: SandboxGrant) => void;
}

export interface SandboxEscalationOutput {
  result: SandboxOperationResult;
  details: SandboxExecutionDetails;
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
    recommendedNextStep: classified.recommendedNextStep,
  };

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
    },
  };
}
