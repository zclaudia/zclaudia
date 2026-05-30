import type { AIReviewResult } from '@zclaudia/shared/interaction/permissions';
import { extractJSONObjects } from '../../../../utils/json-extract.js';

export function normalizeReviewDecision(value: unknown): AIReviewResult['decision'] | null {
  if (typeof value !== 'string') return null;
  switch (value.trim().toLowerCase()) {
    case 'approve':
    case 'approved':
    case 'allow':
    case 'allowed':
    case 'safe':
      return 'approve';
    case 'deny':
    case 'denied':
    case 'reject':
    case 'rejected':
    case 'block':
    case 'blocked':
    case 'unsafe':
      return 'deny';
    case 'uncertain':
    case 'unknown':
    case 'unsure':
    case 'maybe':
    case 'suspicious':
      return 'uncertain';
    default:
      return null;
  }
}

export function parseFinalReviewFromText(
  rawOutput: string,
  errorPrefix: string,
): Pick<AIReviewResult, 'decision' | 'reasoning' | 'confidence'> {
  const candidates = extractJSONObjects(rawOutput);

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(candidates[i]) as Record<string, unknown>;
      const decision = normalizeReviewDecision(parsed.decision ?? parsed.verdict ?? parsed.label);
      if (!decision) continue;
      const reasoning = typeof parsed.reasoning === 'string'
        ? parsed.reasoning
        : typeof parsed.reason === 'string'
          ? parsed.reason
          : typeof parsed.explanation === 'string'
            ? parsed.explanation
            : 'No reasoning provided';
      return {
        decision,
        reasoning,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      };
    } catch {
      // Ignore malformed candidates and keep scanning backwards.
    }
  }

  throw new Error(`${errorPrefix} did not produce a valid final JSON result`);
}

function summarizeText(text: string | undefined, maxLength = 600): string {
  if (!text) return '(empty)';
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

export class ReviewParseError extends Error {
  /** Raw assistant text that failed to parse — callers may pass this upstream for a second parse attempt. */
  readonly rawAssistantText: string;
  constructor(errorPrefix: string, output: string, rawAssistantText: string, cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`${errorPrefix}: ${causeMsg} | output=${summarizeText(output)}`);
    this.name = 'ReviewParseError';
    this.rawAssistantText = rawAssistantText;
  }
}
