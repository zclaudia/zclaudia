import { completeSimple } from '@earendil-works/pi-ai/compat';
import type { Message } from '@earendil-works/pi-ai/compat';
import { buildModel, modelEntryFor } from '../../../infra/providers/pi-runtime/build-model.js';
import { readRecentMessages } from '../../../infra/providers/pi-runtime/session-tree/index.js';
import type { TitleGenerateInput } from './session-title-service.js';
import {
  TITLE_SYSTEM_PROMPT,
  TITLE_INSTRUCTION,
  pickTitleWindow,
  extractTitle,
} from './session-title-helpers.js';

/**
 * Generate a short title using the session's model, or the configured
 * override model when one is set. Mirrors how compaction builds the model
 * (buildModel + llmProfile.apiKey). Returns null on any failure so the caller
 * silently keeps the previous title.
 */
export async function generateSessionTitle(input: TitleGenerateInput): Promise<string | null> {
  const { db, sessionId, agentProfile, llmProfile, modelOverride } = input;
  // A configured override (auto_title_config.model) wins — e.g. a cheaper
  // small model — otherwise the title uses the session's own model.
  const modelId = modelOverride || agentProfile.model;
  const built = buildModel(llmProfile, modelId, modelEntryFor(llmProfile, modelId));

  // Title only needs a handful of messages (pickTitleWindow keeps ~9). Read a
  // bounded recent window from the session tree (Route C) so long sessions don't
  // reconstruct the whole branch just to drop most of it.
  const messages = (await readRecentMessages(db, sessionId, 16)) as unknown as Message[];
  if (messages.length === 0) return null;

  const window = pickTitleWindow(messages);
  const contextMessages: Message[] = [
    ...window,
    { role: 'user', content: [{ type: 'text', text: TITLE_INSTRUCTION }], timestamp: Date.now() },
  ];

  // Prefer a freshly-resolved key (handles OAuth refresh, e.g. openai-codex);
  // fall back to the profile's static key for plain-key providers.
  let apiKey = llmProfile.apiKey ?? '';
  try {
    if (built.getApiKey) {
      const fresh = await built.getApiKey(built.model.provider);
      if (fresh) apiKey = fresh;
    }
  } catch {
    // keep the static key; title generation stays best-effort
  }

  const result = await completeSimple(
    built.model,
    { systemPrompt: TITLE_SYSTEM_PROMPT, messages: contextMessages },
    { apiKey, maxTokens: 32 }
  );

  // completeSimple resolves provider/network failures instead of throwing:
  // stopReason 'error' carries the failure in content, so treat it as no title.
  if (result.stopReason === 'error') return null;

  const title = extractTitle(result.content);
  return title.length > 0 ? title : null;
}
