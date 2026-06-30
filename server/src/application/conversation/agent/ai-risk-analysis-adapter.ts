/**
 * AIRiskAnalysisPort adapter — wraps evaluateAIReview with a provider resolved
 * from configured ZClaudia providers.
 *
 * Compatibility adapter for the older AI review evaluator. Current workflow
 * permission review runs through LightweightAgentRunner directly.
 */

import type Database from 'better-sqlite3';
import type { AIRiskAnalysisPort } from '../../../domains/workflows/ports/step-executor.js';
import { evaluateAIReview, type AIReviewProvider } from './delegation-evaluator.js';
import type { AIReviewConfig } from '@zclaudia/shared/interaction/permissions';
import { VirtualClientAIRunner } from '../../../domains/workflows/step-executors/virtual-client-ai-runner.js';
import type { WorkflowAiRunPort } from '../../../domains/workflows/ports/runtime.js';

export interface AIReviewProviderFactoryContext {
  cwd: string;
  projectId?: string;
}

export type AIReviewProviderFactory = (
  analysisLlmProfileId: string | undefined,
  ctx: AIReviewProviderFactoryContext,
) => AIReviewProvider | undefined;

export interface AIRiskAnalysisAdapterOptions {
  createProvider?: AIReviewProviderFactory;
}

/**
 * AIRiskAnalysisPort implementation that wraps evaluateAIReview().
 *
 * The concrete LLM provider can be supplied by callers that still use the
 * legacy evaluator path.
 */
export class AIRiskAnalysisAdapter implements AIRiskAnalysisPort {
  constructor(
    private readonly db: Database.Database,
    private readonly options: AIRiskAnalysisAdapterOptions = {},
  ) {
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
    projectId?: string;
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
      analysisProvider: this.options.createProvider?.(ctx.config.analysisLlmProfileId, {
        cwd: ctx.cwd,
        projectId: ctx.projectId,
      }),
    });

    return {
      decision: result.decision,
      reasoning: result.reasoning,
      confidence: result.confidence,
      metadata: result.metadata as Record<string, unknown> | undefined,
    };
  }
}

export function createWorkflowAIReviewProviderFactory(
  db: Database.Database,
  aiRunPort: WorkflowAiRunPort,
): AIReviewProviderFactory {
  const runner = new VirtualClientAIRunner(db, aiRunPort);

  return (analysisLlmProfileId, ctx) => {
    if (!ctx.projectId) return undefined;

    let reviewSessionId: string | undefined;

    return {
      runPrompt: async (prompt, sessionId) => {
        const result = await runner.runPrompt({
          projectId: ctx.projectId,
          llmProfileId: analysisLlmProfileId,
          prompt,
          workingDirectory: ctx.cwd,
          sessionName: 'AI Permission Review',
          sessionId: sessionId ?? reviewSessionId,
          timeoutMs: 2 * 60 * 1000,
          onSessionCreated: (createdSessionId) => {
            reviewSessionId = createdSessionId;
          },
        });
        reviewSessionId = result.sessionId;
        return {
          response: result.content,
          sessionId: result.sessionId,
        };
      },
    };
  };
}
