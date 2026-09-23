/**
 * One-shot auxiliary model call for tools that summarize or extract
 * (WebFetch `prompt`, ReadSessionContext). Mirrors how session titles and
 * compaction build the model: the run's own LLM profile + agent model, with a
 * freshly resolved API key when the provider supports it (OAuth refresh).
 *
 * Best-effort by design: every failure returns `null` so the calling tool can
 * fall back to returning raw content instead of failing the tool call.
 */
import { completeSimple } from '@earendil-works/pi-ai/compat';
import type { AssistantMessage, Message, TextContent } from '@earendil-works/pi-ai/compat';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { buildModel, modelEntryFor } from './build-model.js';

export interface AuxiliaryPromptInput {
  systemPrompt: string;
  userText: string;
  maxTokens?: number;
}

export type AuxiliaryComplete = (input: AuxiliaryPromptInput) => Promise<string | null>;

export interface AuxiliaryModelContext {
  llmProfileConfig?: LlmProfileConfig;
  /** Agent-profile model override, resolved against the profile's model list. */
  model?: string;
  /** Test seam / host override: replaces the real provider call. */
  complete?: AuxiliaryComplete;
}

export function hasAuxiliaryModel(ctx: AuxiliaryModelContext | undefined): boolean {
  return Boolean(ctx && (ctx.complete || ctx.llmProfileConfig));
}

function textOf(content: AssistantMessage['content']): string {
  return content
    .filter((c): c is TextContent => c.type === 'text')
    .map(c => c.text)
    .join('\n')
    .trim();
}

export async function runAuxiliaryPrompt(
  ctx: AuxiliaryModelContext | undefined,
  input: AuxiliaryPromptInput
): Promise<string | null> {
  if (!ctx) return null;
  if (ctx.complete) return ctx.complete(input);
  if (!ctx.llmProfileConfig) return null;
  try {
    const profile = ctx.llmProfileConfig;
    const built = buildModel(profile, ctx.model, modelEntryFor(profile, ctx.model));
    let apiKey = profile.apiKey ?? '';
    try {
      if (built.getApiKey) {
        const fresh = await built.getApiKey(built.model.provider);
        if (fresh) apiKey = fresh;
      }
    } catch {
      // keep the static key
    }
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: input.userText }], timestamp: Date.now() },
    ];
    const result = await completeSimple(
      built.model,
      { systemPrompt: input.systemPrompt, messages },
      { apiKey, maxTokens: input.maxTokens ?? 1024 }
    );
    const text = textOf(result.content);
    return text.length > 0 ? text : null;
  } catch (err) {
    console.warn('[auxiliary-model] prompt failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
