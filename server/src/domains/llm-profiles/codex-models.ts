import { getModel } from '@earendil-works/pi-ai';

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
  opts: FetchOptions = {},
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
    const models = (body.models ?? []).map(mapCatalogEntry).filter((m): m is CodexModelEntry => m !== null);

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
  // pi-ai's models.generated registers codex models under provider 'openai-codex'.
  // We probe a known set; any that resolve are surfaced. Missing ones are silently dropped.
  const knownIds = [
    'gpt-5-codex',
    'gpt-5.1-codex',
    'gpt-5.1-codex-mini',
    'gpt-5.1-codex-max',
    'gpt-5.2-codex',
    'gpt-5.3-codex',
  ];

  const out: CodexModelEntry[] = [];
  for (const id of knownIds) {
    try {
      // Cast to `any` because TypeScript's keyof narrowing rejects unknown model IDs at compile time,
      // but the JS runtime returns undefined for missing models rather than throwing.
      const m = getModel('openai-codex', id as any);
      if (m) {
        out.push({
          id,
          displayName: (m as any).name ?? id,
          contextWindow: CONTEXT_WINDOW,
        });
      }
    } catch {
      // not in registry, skip
    }
  }
  return out;
}
