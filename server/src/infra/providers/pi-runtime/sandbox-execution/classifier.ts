import {
  extractNetworkGrantCandidates,
  formatGrantForDisplay,
  formatNetworkGrantKey,
} from './grants.js';
import type { SandboxEvidence, SandboxFailureClassification, SandboxNetworkGrant } from './types.js';

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
  recommendedNextStep?: string;
}

const NETWORK_FAILURE_PATTERNS: Array<{ label: string; re: RegExp }> = [
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

function isDomainAllowed(host: string, allowedDomains: ReadonlySet<string>): boolean {
  for (const domain of allowedDomains) {
    const normalized = domain.toLowerCase();
    if (host === normalized || host.endsWith(`.${normalized}`)) return true;
  }
  return false;
}

function unallowedTargets(
  sourceText: string,
  allowedDomains: ReadonlySet<string>
): SandboxNetworkGrant[] {
  return extractNetworkGrantCandidates(sourceText).filter(
    grant => !isDomainAllowed(grant.host, allowedDomains)
  );
}

function hasSilentCurl(sourceText: string): boolean {
  return /\bcurl\b/.test(sourceText) && /(^|\s)-[A-Za-z]*s[A-Za-z]*(\s|$)/.test(sourceText);
}

function networkSignals(outputText: string): string[] {
  return NETWORK_FAILURE_PATTERNS.filter(pattern => pattern.re.test(outputText)).map(
    pattern => pattern.label
  );
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
  const candidateGrants = unallowedTargets(input.sourceText, input.allowedDomains);
  const candidateTargets = candidateGrants.map(formatGrantForDisplay);
  const matchedSignals = input.sandboxed ? networkSignals(input.outputText) : [];
  const missingSignals: string[] = [];

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
      evidence: { matchedSignals, candidateTargets, missingSignals },
    };
  }

  if (candidateGrants.length > 0 && matchedSignals.length > 0) {
    return {
      classification: 'confirmed_sandbox_denial',
      candidateGrants,
      evidence: { matchedSignals, candidateTargets, missingSignals },
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
        matchedSignals,
        candidateTargets,
        missingSignals,
        inference: `Sandboxed ${input.toolName} failed while referencing ungranted network target ${candidateTargets.join(', ')}.`,
      },
      recommendedNextStep:
        'Re-run with more diagnostics such as curl -sS, or explicitly request sandbox escalation with a reason.',
    };
  }

  return {
    classification: ordinaryFailure(input) ? 'not_sandbox_denial' : 'ambiguous_failure',
    candidateGrants,
    evidence: { matchedSignals, candidateTargets, missingSignals },
    recommendedNextStep: 'Gather more diagnostic output before requesting sandbox escalation.',
  };
}

export function formatGrantKeys(grants: SandboxNetworkGrant[]): string[] {
  return grants.map(formatNetworkGrantKey);
}
