import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { AIRiskAnalysisAdapter } from '../ai-risk-analysis-adapter.js';

const mockEvaluateAIReview = vi.fn();

vi.mock('../delegation-evaluator.js', () => ({
  evaluateAIReview: (...args: unknown[]) => mockEvaluateAIReview(...args),
}));

function createDb(): Database.Database {
  return {
    prepare: () => ({ get: () => undefined }),
  } as unknown as Database.Database;
}

describe('AIRiskAnalysisAdapter', () => {
  beforeEach(() => {
    mockEvaluateAIReview.mockReset();
  });

  it('forwards request context to evaluateAIReview and returns its result', async () => {
    mockEvaluateAIReview.mockResolvedValue({
      decision: 'uncertain',
      reasoning: 'No LLM provider for risk analysis',
      confidence: 0,
    });

    const adapter = new AIRiskAnalysisAdapter(createDb());
    const result = await adapter.evaluate({
      toolName: 'Bash',
      toolInput: { command: 'git status' },
      detail: 'Review this command',
      cwd: '/repo',
      config: {
        confidenceThreshold: 0.8,
        maxAutoApprovalsPerMinute: 10,
        analysisProviderId: 'prov-id',
      },
    });

    expect(result).toMatchObject({
      decision: 'uncertain',
      reasoning: 'No LLM provider for risk analysis',
      confidence: 0,
    });
    expect(mockEvaluateAIReview).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisProviderId: 'prov-id',
        confidenceThreshold: 0.8,
        maxAutoApprovalsPerMinute: 10,
      }),
      expect.objectContaining({
        toolName: 'Bash',
        detail: 'Review this command',
        cwd: '/repo',
      }),
    );
  });

  it('propagates metadata back to the caller', async () => {
    mockEvaluateAIReview.mockResolvedValue({
      decision: 'approve',
      reasoning: 'looks fine',
      confidence: 0.9,
      metadata: { redactionCount: 2 },
    });

    const adapter = new AIRiskAnalysisAdapter(createDb());
    const result = await adapter.evaluate({
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      detail: 'List directory',
      cwd: '/tmp',
      config: { confidenceThreshold: 0.5, maxAutoApprovalsPerMinute: 10 },
    });

    expect(result.metadata).toEqual({ redactionCount: 2 });
  });
});
