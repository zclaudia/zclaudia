import type { Database } from 'better-sqlite3';
import type {
  UpdateWebSearchConfigRequest,
  WebSearchConfig,
  WebSearchConfigSource,
} from '@zclaudia/shared/core/server';

export const MASKED_SECRET = '********';

interface WebSearchConfigRow {
  id: number;
  brave_api_key: string | null;
  searxng_base_url: string | null;
  created_at: number;
  updated_at: number;
}

export interface WebSearchProviderConfig {
  braveApiKey?: string;
  braveApiKeySource: WebSearchConfigSource;
  searxngBaseUrl?: string;
  searxngBaseUrlSource: WebSearchConfigSource;
}

function trimToNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readStoredConfig(db?: Database): WebSearchConfigRow | null {
  if (!db) return null;
  try {
    const row = db
      .prepare(
        `
      SELECT id, brave_api_key, searxng_base_url, created_at, updated_at
      FROM web_search_config
      WHERE id = 1
    `
      )
      .get() as WebSearchConfigRow | undefined;
    return row ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('no such table')) return null;
    throw error;
  }
}

export function ensureWebSearchConfigRow(db: Database): WebSearchConfigRow {
  const now = Date.now();
  db.prepare(
    `
    INSERT OR IGNORE INTO web_search_config (id, created_at, updated_at)
    VALUES (1, ?, ?)
  `
  ).run(now, now);
  const row = readStoredConfig(db);
  if (!row) throw new Error('web_search_config row could not be created');
  return row;
}

export function getWebSearchProviderConfig(db?: Database): WebSearchProviderConfig {
  const row = readStoredConfig(db);
  const storedBraveKey = trimToNull(row?.brave_api_key);
  const envBraveKey =
    trimToNull(process.env.ZCLAUDIA_BRAVE_SEARCH_API_KEY) ??
    trimToNull(process.env.BRAVE_SEARCH_API_KEY);
  const storedSearxngBaseUrl = trimToNull(row?.searxng_base_url);
  const envSearxngBaseUrl =
    trimToNull(process.env.ZCLAUDIA_SEARXNG_BASE_URL) ?? trimToNull(process.env.SEARXNG_BASE_URL);

  return {
    ...(storedBraveKey || envBraveKey
      ? { braveApiKey: storedBraveKey ?? envBraveKey ?? undefined }
      : {}),
    braveApiKeySource: storedBraveKey ? 'stored' : envBraveKey ? 'env' : null,
    ...(storedSearxngBaseUrl || envSearxngBaseUrl
      ? { searxngBaseUrl: storedSearxngBaseUrl ?? envSearxngBaseUrl ?? undefined }
      : {}),
    searxngBaseUrlSource: storedSearxngBaseUrl ? 'stored' : envSearxngBaseUrl ? 'env' : null,
  };
}

export function getWebSearchConfigView(db: Database): WebSearchConfig {
  const row = ensureWebSearchConfigRow(db);
  const providerConfig = getWebSearchProviderConfig(db);
  return {
    braveApiKey: providerConfig.braveApiKey ? MASKED_SECRET : null,
    braveApiKeySource: providerConfig.braveApiKeySource,
    searxngBaseUrl: providerConfig.searxngBaseUrl ?? null,
    searxngBaseUrlSource: providerConfig.searxngBaseUrlSource,
    duckDuckGoFallbackEnabled: true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateWebSearchConfig(
  db: Database,
  input: UpdateWebSearchConfigRequest
): WebSearchConfig {
  ensureWebSearchConfigRow(db);
  const updates: string[] = [];
  const params: unknown[] = [];

  if (Object.prototype.hasOwnProperty.call(input, 'braveApiKey')) {
    const braveApiKey = trimToNull(input.braveApiKey);
    if (braveApiKey !== MASKED_SECRET) {
      updates.push('brave_api_key = ?');
      params.push(braveApiKey);
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'searxngBaseUrl')) {
    const searxngBaseUrl = trimToNull(input.searxngBaseUrl);
    updates.push('searxng_base_url = ?');
    params.push(searxngBaseUrl);
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(Date.now(), 1);
    db.prepare(`UPDATE web_search_config SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  return getWebSearchConfigView(db);
}
