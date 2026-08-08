import { getModels } from '@earendil-works/pi-ai/compat';

const CONTEXT_WINDOW = 272_000;
const TTL_MS = 5 * 60 * 1000;
const ENDPOINT = 'https://chatgpt.com/backend-api/codex/models';

export interface CodexModelEntry {
  id: string;
  displayName: string;
  contextWindow: number;
  supportedReasoningEfforts?: string[];
}

export interface CodexModelsResult {
  models: CodexModelEntry[];
  fetchedAt: number;
  source: 'live' | 'cache' | 'fallback';
}

const cache = new Map<string, CodexModelsResult>();

/**
 * Internal helper for tests only. Don't call from production code.
 */
export function _resetCodexModelsCacheForTest(): void {
  cache.clear();
}

interface FetchOptions {
  refresh?: boolean;
  clientVersion?: string;
}

export async function fetchCodexModels(
  profileId: string,
  accessToken: string,
  accountId: string,
  opts: FetchOptions = {}
): Promise<CodexModelsResult> {
  const now = Date.now();
  if (!opts.refresh) {
    const hit = cache.get(profileId);
    if (hit && now - hit.fetchedAt < TTL_MS) {
      return { ...hit, source: 'cache' };
    }
  }

  try {
    const clientVersion = opts.clientVersion ?? 'zclaudia-0.0.0';
    const url = `${ENDPOINT}?client_version=${encodeURIComponent(clientVersion)}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'ChatGPT-Account-Id': accountId,
        'OpenAI-Beta': 'responses=experimental',
        originator: 'zclaudia',
      },
    });
    if (!resp.ok) throw new Error(`Codex /models returned ${resp.status}`);

    const body = (await resp.json()) as { models?: Array<Record<string, unknown>> };
    const models = (body.models ?? [])
      .map(mapCatalogEntry)
      .filter((m): m is CodexModelEntry => m !== null);

    const result: CodexModelsResult = { models, fetchedAt: now, source: 'live' };
    cache.set(profileId, result);
    return result;
  } catch {
    const fallback = bundledFallback();
    const result: CodexModelsResult = { models: fallback, fetchedAt: now, source: 'fallback' };
    cache.set(profileId, result);
    return result;
  }
}

function mapCatalogEntry(raw: Record<string, unknown>): CodexModelEntry | null {
  const id = typeof raw.slug === 'string' ? raw.slug : null;
  if (!id) return null;
  return {
    id,
    displayName: typeof raw.display_name === 'string' ? raw.display_name : id,
    contextWindow: CONTEXT_WINDOW, // hard-clamp
    supportedReasoningEfforts: Array.isArray(raw.supported_reasoning_levels)
      ? (raw.supported_reasoning_levels as string[])
      : undefined,
  };
}

function bundledFallback(): CodexModelEntry[] {
  try {
    const models = getModels('openai-codex');
    return models.map(m => ({
      id: m.id,
      displayName: (m as any).name ?? m.id,
      contextWindow: CONTEXT_WINDOW, // hard-clamp
    }));
  } catch {
    return [];
  }
}
