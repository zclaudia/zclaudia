import { Router, type Request, type Response } from 'express';
import type { Database } from 'better-sqlite3';
import type { UpdateWebSearchConfigRequest } from '@zclaudia/shared/core/server';
import { getWebSearchConfigView, updateWebSearchConfig } from '../../domains/web-search/config.js';
import { sendApiError } from './response.js';

function validateSearxngBaseUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('SearXNG base URL must be a string');
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('SearXNG base URL must be a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('SearXNG base URL must use http or https');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function normalizeUpdateBody(body: Record<string, unknown>): UpdateWebSearchConfigRequest {
  const update: UpdateWebSearchConfigRequest = {};
  if (Object.prototype.hasOwnProperty.call(body, 'braveApiKey')) {
    if (body.braveApiKey !== null && typeof body.braveApiKey !== 'string') {
      throw new Error('Brave API key must be a string');
    }
    update.braveApiKey = body.braveApiKey;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'searxngBaseUrl')) {
    update.searxngBaseUrl = validateSearxngBaseUrl(body.searxngBaseUrl);
  }
  return update;
}

export function createWebSearchConfigRoutes(db: Database): Router {
  const router = Router();

  router.get('/config', (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: getWebSearchConfigView(db) });
    } catch (error) {
      sendApiError(
        res,
        500,
        'WEB_SEARCH_CONFIG_READ_FAILED',
        error instanceof Error ? error.message : 'Failed to read Web Search configuration'
      );
    }
  });

  router.put('/config', (req: Request, res: Response) => {
    try {
      const body =
        req.body && typeof req.body === 'object' && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};
      const update = normalizeUpdateBody(body);
      res.json({ success: true, data: updateWebSearchConfig(db, update) });
    } catch (error) {
      sendApiError(
        res,
        400,
        'WEB_SEARCH_CONFIG_INVALID',
        error instanceof Error ? error.message : 'Invalid Web Search configuration'
      );
    }
  });

  return router;
}
