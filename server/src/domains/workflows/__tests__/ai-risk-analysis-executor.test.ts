import { describe, expect, it, vi } from 'vitest';
import type { AgentLoopRunnerPort } from '../../agent-loop/index.js';
import { AIRiskAnalysisStepExecutor } from '../step-executors/ai-risk-analysis-executor.js';
import type { StepContext } from '../ports/step-executor.js';

function makeContext(eventPayload: Record<string, unknown>): StepContext {
  return {
    runId: 'run-1',
    stepRunId: 'step-run-1',
    projectId: 'project-1',
    projectRootPath: '/repo',
    llmProfileId: 'fallback-profile',
    results: new Map(),
    eventPayload,
    resolveTemplate: (template: string) => template
      .replace('${event.toolName}', String(eventPayload.toolName ?? ''))
      .replace('${event.detail}', String(eventPayload.detail ?? '')),
    setSessionId: vi.fn(),
  };
}

describe('AIRiskAnalysisStepExecutor', () => {
  it('uses AI review settings from the permission escalation payload', async () => {
    const run = vi.fn(async () => ({
      status: 'completed' as const,
      output: {
        decision: 'approve',
        reasoning: 'safe command',
        confidence: 0.95,
      },
      contextId: 'ctx-risk',
    }));
    const executor = new AIRiskAnalysisStepExecutor({ run } as unknown as AgentLoopRunnerPort);

    const result = await executor.execute({ id: 'ai_review', name: 'AI Review', type: 'ai_risk_analysis' } as any, {}, makeContext({
      requestId: 'req-1',
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      detail: 'npm test',
      cwd: '/repo',
      aiReview: {
        enabled: true,
        confidenceThreshold: 0.92,
        maxAutoApprovalsPerMinute: 3,
        analysisLlmProfileId: 'review-provider',
      },
    }));

    expect(result).toMatchObject({
      status: 'completed',
      output: {
        decision: 'approve',
        approved: true,
        contextId: 'ctx-risk',
      },
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'workflow.ai_risk_analysis',
      llmProfileId: 'review-provider',
      toolset: { id: 'permission-review' },
      context: { policy: 'step-local', key: 'permission:req-1:ai_review' },
    }));
    expect(run.mock.calls[0]?.[0].input).toContain('"confidenceThreshold":0.92');
    expect(run.mock.calls[0]?.[0].input).toContain('"maxAutoApprovalsPerMinute":3');
  });

  it('skips LLM analysis when AI review is disabled in the permission policy', async () => {
    const run = vi.fn();
    const executor = new AIRiskAnalysisStepExecutor({ run } as unknown as AgentLoopRunnerPort);

    const result = await executor.execute({ id: 'ai_review', name: 'AI Review', type: 'ai_risk_analysis' } as any, {}, makeContext({
      requestId: 'req-1',
      toolName: 'Bash',
      toolInput: { command: 'rm -rf build' },
      detail: 'rm -rf build',
      cwd: '/repo',
      aiReview: {
        enabled: false,
        confidenceThreshold: 0.7,
        maxAutoApprovalsPerMinute: 10,
      },
    }));

    expect(result).toMatchObject({
      status: 'completed',
      output: {
        decision: 'uncertain',
        approved: false,
      },
    });
    expect(String(result.output.reasoning)).toContain('disabled');
    expect(run).not.toHaveBeenCalled();
  });
});
