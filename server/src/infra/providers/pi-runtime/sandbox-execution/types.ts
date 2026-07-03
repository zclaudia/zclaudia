export type SandboxFailureClassification =
  | 'confirmed_sandbox_denial'
  | 'probable_sandbox_denial'
  | 'ambiguous_failure'
  | 'not_sandbox_denial';

export type SandboxPrivilegeMode = 'auto' | 'sandbox' | 'unsandboxed';

export interface SandboxNetworkGrant {
  type: 'network';
  protocol?: 'http' | 'https';
  host: string;
  port?: number;
}

export type SandboxGrant = SandboxNetworkGrant;

export interface SandboxEvidence {
  matchedSignals: string[];
  candidateTargets: string[];
  missingSignals: string[];
  inference?: string;
  internalProxyUrls?: string[];
}

export interface SandboxExecutionDetails {
  sandboxed: boolean;
  privilegeMode: 'sandbox' | 'capability-granted' | 'unsandboxed';
  failureClassification?: SandboxFailureClassification;
  sandboxEvidence?: SandboxEvidence;
  recommendedPrivilegeMode?: SandboxPrivilegeMode;
  sandboxInternalProxyDetected?: boolean;
  sandboxInternalProxyUrls?: string[];
  grantsUsed?: SandboxGrant[];
  escalationRequested?: boolean;
  unsandboxedApproved?: boolean;
  recommendedNextStep?: string;
}

export interface SandboxPrivilegeRequest {
  sandboxMode: SandboxPrivilegeMode;
  privilegeReason?: string;
}
