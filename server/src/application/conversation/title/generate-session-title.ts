import { completeSimple } from '@earendil-works/pi-ai';
import type { Message } from '@earendil-works/pi-ai';
import { Session } from '@earendil-works/pi-agent-core';
import { buildModel } from '../../../infra/providers/pi-runtime/build-model.js';
import { SqliteSessionStorage } from '../../../infra/providers/pi-runtime/session-tree/index.js';
import type { TitleGenerateInput } from './session-title-service.js';
import {
  TITLE_SYSTEM_PROMPT,
  TITLE_INSTRUCTION,
  pickTitleWindow,
  extractTitle,
} from './session-title-helpers.js';

/**
 * Generate a short title using the session's own model. Mirrors how compaction
 * builds the model (buildModel + llmProfile.apiKey). Returns null on any failure
 * so the caller silently keeps the previous title.
 */
export async function generateSessionTitle(input: TitleGenerateInput): Promise<string | null> {
  const { db, sessionId, agentProfile, llmProfile } = input;
  const built = buildModel(llmProfile, agentProfile.model);

  // Title only needs a handful of messages (pickTitleWindow keeps ~9). Read the
  // session tree (Route C) and cap to the recent window so long sessions don't
  // reconstruct the whole history just to drop it.
  const session = new Session(new SqliteSessionStorage(db, sessionId));
  const all = (await session.buildContext()).messages as unknown as Message[];
  if (all.length === 0) return null;
  const messages = all.slice(-16);

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
    { apiKey, maxTokens: 32 },
  );

  const title = extractTitle(result.content);
  return title.length > 0 ? title : null;
}
