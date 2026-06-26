/**
 * AnthropicEvaluatorPort — concrete EvaluatorLlmPort implementation.
 *
 * NOTE: The project's LLM dispatch layer (see turn-summaries/service.ts) currently
 * uses a stub implementation while pi-agent integration is pending. This port
 * therefore also stubs the dispatch. When real LLM integration lands, update
 * this method to mirror whatever pattern turn-summaries uses (likely a direct
 * Anthropic SDK call or an injected provider adapter).
 *
 * The integration test in __tests__/lifecycle.integration.test.ts stubs this
 * port entirely, so production wiring can land incrementally.
 */
import { EVALUATOR_SYSTEM_PROMPT } from '../evaluator.js';
import type { EvaluatorLlmPort, EvaluatorLlmResult, EvaluatorRequest } from '../evaluator.js';

export interface AnthropicEvaluatorPortDeps {
  /** LLM profile ID to use for evaluator calls (reserved for future use). */
  defaultLlmProfileId?: string;
}

export class AnthropicEvaluatorPort implements EvaluatorLlmPort {
  // EVALUATOR_SYSTEM_PROMPT is imported for future use when real dispatch lands.
  private readonly systemPrompt = EVALUATOR_SYSTEM_PROMPT;

  constructor(private readonly deps: AnthropicEvaluatorPortDeps = {}) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async evaluate(_req: EvaluatorRequest): Promise<EvaluatorLlmResult> {
    // TODO(pi-agent): replace with real LLM call once provider dispatch is wired.
    // The integration test stubs this port — this body is only reached in production,
    // where the goal will fall through to an 'error' verdict in GoalEvaluator.catch().
    throw new Error(
      '[AnthropicEvaluatorPort] LLM dispatch not yet implemented — pi-agent integration pending',
    );
  }
}
