/**
 * AIRiskAnalysisPort adapter — wraps evaluateAIReview with a provider resolved
 * from configured ZClaudia providers.
 *
 * Used by the permission workflow's ai_risk_analysis step to run AI-assisted
 * safety analysis of escalated tool calls.
 */

import type Database from 'better-sqlite3';
import type { AIRiskAnalysisPort } from '../../../domains/workflows/ports/step-executor.js';
import { evaluateAIReview } from './delegation-evaluator.js';
import type { AIReviewConfig } from '@zclaudia/shared/interaction/permissions';

/**
 * AIRiskAnalysisPort implementation that wraps evaluateAIReview().
 *
 * The concrete LLM provider is currently unwired — `evaluateAIReview` will
 * return an `uncertain` placeholder until the pi-agent runtime supplies an
 * `AIReviewProvider`.
 */
export class AIRiskAnalysisAdapter implements AIRiskAnalysisPort {
  constructor(private readonly db: Database.Database) {
    void this.db;
  }

  async evaluate(ctx: {
    toolName: string;
    toolInput: unknown;
    detail: string;
    cwd: string;
    config: {
      confidenceThreshold: number;
      maxAutoApprovalsPerMinute: number;
      analysisLlmProfileId?: string;
    };
  }): Promise<{
    decision: 'approve' | 'deny' | 'uncertain';
    reasoning: string;
    confidence: number;
    metadata?: Record<string, unknown>;
  }> {
    const config: AIReviewConfig = {
      enabled: true,
      timeoutBeforeReview: 0,
      confidenceThreshold: ctx.config.confidenceThreshold,
      maxAutoApprovalsPerMinute: ctx.config.maxAutoApprovalsPerMinute,
      analysisLlmProfileId: ctx.config.analysisLlmProfileId,
    };

    const result = await evaluateAIReview(config, {
      toolName: ctx.toolName,
      toolInput: ctx.toolInput,
      detail: ctx.detail,
      cwd: ctx.cwd,
    });

    return {
      decision: result.decision,
      reasoning: result.reasoning,
      confidence: result.confidence,
      metadata: result.metadata as Record<string, unknown> | undefined,
    };
  }
}
