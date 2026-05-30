/**
 * Delegation Evaluator — AI-assisted permission auto-resolution.
 *
 * evaluateAIReview() — triggered on timeout for escalated commands.
 */

import type { AIReviewConfig, AIReviewResult } from '@zclaudia/shared/interaction/permissions';
import { classify } from './permission-evaluator.js';
import {
  guardReviewText,
  type ReviewPayloadDisposition,
} from './review-payload-guard.js';
import { resolve, isAbsolute } from 'path';
import {
  isRateLimited,
  recordApproval,
  appendAIReviewDebugLog,
  logAIReviewPayload,
} from './delegation/config.js';
import {
  summarizeAIReviewResponse,
  buildRepairPrompt,
  parseAIReviewResponse,
  type AIReviewModelResponse,
  type ExtendedAIReviewMetadata,
} from './delegation/ai-review-parsing.js';
import {
  MAX_REVIEW_FILES,
  MAX_REVIEW_TURNS,
  collectCandidateScripts,
  readReviewFile,
  buildInitialReviewPrompt,
  buildFileResultPrompt,
} from './delegation/script-discovery.js';

export {
  getDelegationConfig,
  saveDelegationConfig,
  DEFAULT_DELEGATION_CONFIG,
  _resetRateLimiterForTesting,
  type DelegationConfig,
} from './delegation/config.js';

// ============================================
// v3: AI Review — triggered on timeout for escalated commands
// ============================================

/** Provider interface for AI review LLM calls */
export interface AIReviewProvider {
  runPrompt: (prompt: string, sessionId?: string) => Promise<{ response: string; sessionId?: string }>;
}

export interface AIReviewContext {
  toolName: string;
  toolInput: unknown;
  detail: string;
  /** Workspace root — used to resolve relative script paths */
  cwd?: string;
  /** Provider to use for LLM analysis */
  analysisProvider?: AIReviewProvider;
  /** Shared session ID for session reuse (managed by AIReviewQueue) */
  sessionId?: string;
}

// AIReviewResult is re-exported from @zclaudia/shared
export type { AIReviewResult } from '@zclaudia/shared/interaction/permissions';

/**
 * AI review for escalated permission requests — triggered after user timeout.
 *
 * Flow:
 * 1. Rate limited? → uncertain
 * 2. LLM analysis → decision with confidence
 * 3. Confidence < threshold? → uncertain (keep waiting for user)
 */
/** AI review result extended with session ID for reuse */
export interface AIReviewResultWithSession extends AIReviewResult {
  sessionId?: string;
}

export async function evaluateAIReview(
  config: AIReviewConfig,
  ctx: AIReviewContext,
): Promise<AIReviewResultWithSession> {
  // 1. Rate limit
  if (isRateLimited(config.maxAutoApprovalsPerMinute)) {
    console.log(`[AI Review] Skipped: rate limit exceeded`);
    return { decision: 'uncertain', reasoning: 'Rate limit exceeded', confidence: 0 };
  }

  // 2. LLM analysis
  if (!ctx.analysisProvider) {
    console.log(`[AI Review] Skipped: no analysis provider available`);
    return { decision: 'uncertain', reasoning: 'No LLM provider for risk analysis', confidence: 0 };
  }

  try {
    console.log(`[AI Review] Running LLM analysis for: ${ctx.toolName} (sessionId=${ctx.sessionId || 'new'})`);
    const llmResult = await analyzeLLMRisk(ctx);

    console.log(`[AI Review] LLM result: decision=${llmResult.decision} confidence=${llmResult.confidence} reasoning=${llmResult.reasoning?.slice(0, 100)}`);

    if (llmResult.confidence >= config.confidenceThreshold) {
      if (llmResult.decision === 'approve') recordApproval();
      return llmResult;
    }

    // Confidence too low → uncertain
    return {
      decision: 'uncertain',
      reasoning: `LLM confidence ${(llmResult.confidence * 100).toFixed(0)}% below threshold ${(config.confidenceThreshold * 100).toFixed(0)}%: ${llmResult.reasoning}`,
      confidence: llmResult.confidence,
      sessionId: llmResult.sessionId,
      metadata: llmResult.metadata,
    };
  } catch (err) {
    console.error(`[AI Review] LLM analysis failed:`, err);
    return {
      decision: 'uncertain',
      reasoning: 'AI review could not produce a reliable result; keeping this request pending for user review',
      confidence: 0,
    };
  }
}

/** Call LLM to analyze the risk of a tool call */
async function analyzeLLMRisk(ctx: AIReviewContext): Promise<AIReviewResultWithSession> {
  const command = (ctx.toolInput as { command?: string } | undefined)?.command || ctx.detail || '';
  const workspaceRoot = resolve(ctx.cwd || process.cwd());
  const candidateScripts = collectCandidateScripts(command, workspaceRoot).slice(0, MAX_REVIEW_FILES);
  const allowedFiles = new Map(candidateScripts.map((item) => [item.resolvedPath, item]));
  const reviewedFiles = new Set<string>();
  let totalBytesUsed = 0;
  const detailGuard = guardReviewText(ctx.detail);
  const inputGuard = guardReviewText(JSON.stringify(ctx.toolInput, null, 2).slice(0, 800));
  const payloadDisposition: ReviewPayloadDisposition =
    detailGuard.disposition === 'do_not_send' || inputGuard.disposition === 'do_not_send'
      ? 'do_not_send'
      : detailGuard.disposition === 'send_with_redaction' || inputGuard.disposition === 'send_with_redaction'
        ? 'send_with_redaction'
        : 'safe_to_send';
  const redactionCount = detailGuard.redactionCount + inputGuard.redactionCount;
  if (payloadDisposition === 'do_not_send') {
    return {
      decision: 'uncertain',
      reasoning: `Remote AI review skipped because the request payload may contain sensitive local material: ${[...detailGuard.reasons, ...inputGuard.reasons].join('; ')}`,
      confidence: 0,
      metadata: {
        payloadDisposition,
        redactionCount,
        reviewedFileCount: 0,
      } as ExtendedAIReviewMetadata,
    };
  }

  let reviewPrompt = buildInitialReviewPrompt(ctx, candidateScripts, detailGuard.text, inputGuard.text);
  let currentSessionId = ctx.sessionId;
  let attemptedFormatRepair = false;

  for (let turn = 0; turn < MAX_REVIEW_TURNS; turn += 1) {
    logAIReviewPayload('prompt', turn + 1, currentSessionId, reviewPrompt);
    const { response, sessionId: returnedSessionId } = await ctx.analysisProvider!.runPrompt(reviewPrompt, currentSessionId);
    currentSessionId = returnedSessionId || currentSessionId;
    logAIReviewPayload('response', turn + 1, currentSessionId, response);
    let parsed: AIReviewModelResponse;
    try {
      parsed = parseAIReviewResponse(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'unknown error';
      console.warn(
        `[AI Review] Invalid LLM response on turn ${turn + 1}/${MAX_REVIEW_TURNS}: ${errorMessage}; response=${summarizeAIReviewResponse(response)}`
      );
      appendAIReviewDebugLog(
        `kind=parse_error\nturn=${turn + 1}\nsessionId=${currentSessionId || 'new'}\nerror=${errorMessage}\nsummary=${summarizeAIReviewResponse(response)}`
      );
      if (!attemptedFormatRepair) {
        attemptedFormatRepair = true;
        reviewPrompt = buildRepairPrompt(response, errorMessage);
        continue;
      }
      throw error;
    }
    attemptedFormatRepair = false;

    if (parsed.type === 'final') {
      return {
        ...parsed,
        sessionId: currentSessionId,
        metadata: {
          payloadDisposition,
          redactionCount,
          reviewedFileCount: reviewedFiles.size,
        } as ExtendedAIReviewMetadata,
      };
    }

    const resolvedRequestedPath = isAbsolute(parsed.path)
      ? resolve(parsed.path)
      : resolve(workspaceRoot, parsed.path);

    if (reviewedFiles.has(resolvedRequestedPath)) {
      reviewPrompt = buildFileResultPrompt({
        ok: false,
        path: parsed.path,
        resolvedPath: resolvedRequestedPath,
        reason: 'That file was already provided for this review',
      });
      continue;
    }
    if (reviewedFiles.size >= MAX_REVIEW_FILES) {
      return {
        decision: 'uncertain',
        reasoning: 'AI review requested too many files',
        confidence: 0,
        sessionId: currentSessionId,
      };
    }

    const fileResult = await readReviewFile(parsed.path, workspaceRoot, allowedFiles, totalBytesUsed, command);
    if (fileResult.ok && fileResult.bytesReturned) {
      reviewedFiles.add(fileResult.resolvedPath!);
      totalBytesUsed += fileResult.bytesReturned;
    }
    reviewPrompt = buildFileResultPrompt(fileResult);
  }

  return {
    decision: 'uncertain',
    reasoning: 'AI review exceeded the maximum analysis turns',
    confidence: 0,
    sessionId: currentSessionId,
    metadata: {
      payloadDisposition,
      redactionCount,
      reviewedFileCount: reviewedFiles.size,
    } as ExtendedAIReviewMetadata,
  };
}

