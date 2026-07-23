import {
  extractNetworkGrantCandidates,
  formatGrantForDisplay,
  formatNetworkGrantKey,
} from './grants.js';
import type {
  SandboxEvidence,
  SandboxFailureClassification,
  SandboxNetworkGrant,
  SandboxPrivilegeMode,
} from './types.js';

export interface SandboxFailureInput {
  toolName: 'Bash' | 'Eval';
  sourceText: string;
  outputText: string;
  sandboxed: boolean;
  allowedDomains: ReadonlySet<string>;
  exitCode?: number | null;
  timedOut?: boolean;
}

export interface SandboxFailureClassificationResult {
  classification: SandboxFailureClassification;
  evidence: SandboxEvidence;
  candidateGrants: SandboxNetworkGrant[];
  recommendedPrivilegeMode?: SandboxPrivilegeMode;
  recommendedNextStep?: string;
}

const NETWORK_FAILURE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  {
    label: 'sandbox-runtime localhost proxy env',
    re: /\b(?:https?|all)_proxy=http:\/\/(?:localhost|127\.0\.0\.1):\d+\b/i,
  },
  { label: 'curl error output', re: /curl:\s*\(\d+\)/i },
  { label: 'dns resolution failure', re: /could(?:n'?t| not) resolve host/i },
  { label: 'connection failure text', re: /connection (?:timed out|refused|reset)/i },
  {
    label: 'node network error code',
    re: /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|ENETUNREACH)\b/i,
  },
  { label: 'fetch failed', re: /\bfetch failed\b/i },
  { label: 'wget network failure', re: /wget:.*(?:unable to resolve|failed|timed out)/i },
];

const HOST_ONLY_FAILURE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  {
    label: 'localhost bind denied by sandbox',
    re: /error while attempting to bind on address .*?(?:127\.0\.0\.1|localhost).*?(?:operation not permitted|permission denied)/i,
  },
  {
    label: 'localhost bind denied by sandbox',
    re: /\bbind\([^)]*(?:127\.0\.0\.1|localhost)[^)]*\).*?(?:operation not permitted|permission denied)/i,
  },
];

const INTERNAL_PROXY_ENV_RE =
  /\b(?:https?|all)_proxy=(http:\/\/(?:localhost|127\.0\.0\.1):\d+)\b/gi;

/** Loopback/unspecified hosts are not governed by network grants: the sandbox
 * proxies outbound domains but does not block loopback connects (verified
 * empirically — sandboxed `curl http://127.0.0.1:<port>` succeeds when a
 * server is listening). A loopback connect failure means nothing is listening,
 * not that the sandbox denied it. Loopback *binds* are still denied and are
 * covered separately by HOST_ONLY_FAILURE_PATTERNS. */
function isLoopbackHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host.startsWith('127.')
  );
}

function isDomainAllowed(host: string, allowedDomains: ReadonlySet<string>): boolean {
  for (const domain of allowedDomains) {
    const normalized = domain.toLowerCase();
    if (host === normalized || host.endsWith(`.${normalized}`)) return true;
  }
  return false;
}

function splitTargets(
  sourceText: string,
  allowedDomains: ReadonlySet<string>
): { candidateGrants: SandboxNetworkGrant[]; loopbackTargets: SandboxNetworkGrant[] } {
  const candidateGrants: SandboxNetworkGrant[] = [];
  const loopbackTargets: SandboxNetworkGrant[] = [];
  for (const grant of extractNetworkGrantCandidates(sourceText)) {
    if (isLoopbackHost(grant.host)) loopbackTargets.push(grant);
    else if (!isDomainAllowed(grant.host, allowedDomains)) candidateGrants.push(grant);
  }
  return { candidateGrants, loopbackTargets };
}

function hasSilentCurl(sourceText: string): boolean {
  return /\bcurl\b/.test(sourceText) && /(^|\s)-[A-Za-z]*s[A-Za-z]*(\s|$)/.test(sourceText);
}

function networkSignals(outputText: string): string[] {
  return NETWORK_FAILURE_PATTERNS.filter(pattern => pattern.re.test(outputText)).map(
    pattern => pattern.label
  );
}

function hostOnlySignals(outputText: string): string[] {
  return HOST_ONLY_FAILURE_PATTERNS.filter(pattern => pattern.re.test(outputText)).map(
    pattern => pattern.label
  );
}

function internalProxyUrls(outputText: string): string[] {
  const urls = new Set<string>();
  for (const match of outputText.matchAll(INTERNAL_PROXY_ENV_RE)) {
    urls.add(match[1]);
  }
  return [...urls];
}

function ordinaryFailure(input: SandboxFailureInput): boolean {
  if (input.exitCode === 127) return true;
  if (input.outputText.includes('command not found')) return true;
  if (/\bHTTP[:/ ]+404\b/i.test(input.outputText)) return true;
  if (input.timedOut === true) return true;
  return false;
}

export function classifySandboxFailure(
  input: SandboxFailureInput
): SandboxFailureClassificationResult {
  const { candidateGrants, loopbackTargets } = splitTargets(input.sourceText, input.allowedDomains);
  const candidateTargets = candidateGrants.map(formatGrantForDisplay);
  const matchedSignals = input.sandboxed
    ? [...networkSignals(input.outputText), ...hostOnlySignals(input.outputText)]
    : [];
  const matchedHostOnlySignals = input.sandboxed ? hostOnlySignals(input.outputText) : [];
  const detectedInternalProxyUrls = input.sandboxed ? internalProxyUrls(input.outputText) : [];
  const missingSignals: string[] = [];
  const evidenceBase = {
    matchedSignals,
    candidateTargets,
    missingSignals,
    ...(detectedInternalProxyUrls.length ? { internalProxyUrls: detectedInternalProxyUrls } : {}),
  };

  if (!input.sandboxed) {
    return {
      classification: ordinaryFailure(input) ? 'not_sandbox_denial' : 'ambiguous_failure',
      candidateGrants,
      evidence: {
        matchedSignals: [],
        candidateTargets,
        missingSignals: ['tool did not run under sandbox'],
      },
    };
  }

  if (ordinaryFailure(input) && candidateGrants.length === 0) {
    return {
      classification: 'not_sandbox_denial',
      candidateGrants,
      evidence: evidenceBase,
    };
  }

  if (matchedHostOnlySignals.length > 0) {
    return {
      classification: 'confirmed_sandbox_denial',
      candidateGrants,
      evidence: {
        ...evidenceBase,
        inference:
          'Sandboxed execution cannot perform this host-only operation; least-privilege network grants will not fix it.',
      },
      recommendedPrivilegeMode: 'unsandboxed',
      recommendedNextStep:
        'Request SandboxUnsandboxedAccess by retrying with sandbox_mode:"unsandboxed" and privilege_reason explaining the host-only bind/browser/credential requirement.',
    };
  }

  if (loopbackTargets.length > 0 && candidateGrants.length === 0) {
    return {
      classification: 'not_sandbox_denial',
      candidateGrants,
      evidence: {
        ...evidenceBase,
        inference:
          'Command failure references only loopback targets. The sandbox does not block loopback connects, so the local service is most likely not listening on that port.',
      },
      recommendedNextStep:
        'Verify the local service is actually running and listening (e.g. check the background task output) instead of changing sandbox privileges.',
    };
  }

  if (candidateGrants.length > 0 && matchedSignals.length > 0) {
    return {
      classification: 'confirmed_sandbox_denial',
      candidateGrants,
      evidence: evidenceBase,
      recommendedNextStep: `Request SandboxCapabilityAccess for ${candidateTargets.join(', ')}.`,
    };
  }

  if (candidateGrants.length > 0 && input.exitCode !== 0 && input.exitCode !== undefined) {
    missingSignals.push('network error output');
    if (hasSilentCurl(input.sourceText)) {
      missingSignals.push('curl stderr may be suppressed by -s');
    }
    return {
      classification: 'probable_sandbox_denial',
      candidateGrants,
      evidence: {
        ...evidenceBase,
        inference: `Sandboxed ${input.toolName} failed while referencing ungranted network target ${candidateTargets.join(', ')}.`,
      },
      recommendedNextStep:
        'Re-run with more diagnostics such as curl -sS, or explicitly request sandbox escalation with a reason.',
    };
  }

  const hasSandboxShape = matchedSignals.length > 0 || candidateGrants.length > 0;
  return {
    classification: ordinaryFailure(input) ? 'not_sandbox_denial' : 'ambiguous_failure',
    candidateGrants,
    evidence: evidenceBase,
    // Only mention escalation when something actually looks sandbox-related;
    // otherwise a plain program error keeps getting nudged toward privilege
    // changes it does not need.
    recommendedNextStep: hasSandboxShape
      ? 'Gather more diagnostic output before requesting sandbox escalation.'
      : 'No sandbox-denial signals detected. Debug this as an ordinary command failure.',
  };
}

export function formatGrantKeys(grants: SandboxNetworkGrant[]): string[] {
  return grants.map(formatNetworkGrantKey);
}
