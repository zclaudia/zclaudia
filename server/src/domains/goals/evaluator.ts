import { GOAL_DEFAULTS } from '@zclaudia/shared';
import type { EvaluatorVerdict, EvaluatorVerdictKind } from '@zclaudia/shared';

export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
}

export interface EvaluatorRequest {
  objective: string;
  transcript: TranscriptMessage[];
  llmProfileId: string;
}

export interface EvaluatorLlmResult {
  kind: 'done' | 'continue' | 'blocked';
  reason: string;
  inputTokens: number;
  outputTokens: number;
}

export interface EvaluatorLlmPort {
  evaluate(req: EvaluatorRequest): Promise<EvaluatorLlmResult>;
}

export interface EvaluatorResult {
  verdict: EvaluatorVerdict;
  tokensUsed: number;
}

export const EVALUATOR_SYSTEM_PROMPT =
  'You are a goal evaluator. The user has set a completion condition. ' +
  'Read the transcript and decide whether the condition is now verifiably met (`done`), ' +
  'the agent is stuck or fundamentally blocked from making progress (`blocked`), ' +
  'or work should continue (`continue`). Only judge based on evidence in the transcript — ' +
  'do not infer from intent or claims. When unsure, output `continue`. Keep `reason` under 200 chars.';

export class GoalEvaluator {
  constructor(private port: EvaluatorLlmPort) {}

  async evaluate(req: EvaluatorRequest): Promise<EvaluatorResult> {
    const windowed = req.transcript.slice(-GOAL_DEFAULTS.evaluatorTranscriptWindow);
    try {
      const result = await this.port.evaluate({
        objective: req.objective,
        transcript: windowed,
        llmProfileId: req.llmProfileId,
      });
      const kind = result.kind as EvaluatorVerdictKind;
      return {
        verdict: { kind, reason: (result.reason ?? '').slice(0, 200) },
        tokensUsed: result.inputTokens + result.outputTokens,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { verdict: { kind: 'error', reason: message.slice(0, 200) }, tokensUsed: 0 };
    }
  }
}
