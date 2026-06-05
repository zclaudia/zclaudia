import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { LLM_PROVIDER_TYPES } from '@zclaudia/shared/core/llm-profile';
import type { LlmProfileConfig, LlmProfileModelEntry } from '@zclaudia/shared/core/llm-profile';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import { LlmProfileRepository } from './repository.js';
import {
  LlmProfileDeletionService,
  LlmProfileInUseError,
  LlmProfileNotFoundError,
} from './llm-profile-deletion-service.js';
import { fetchModelsForProfile } from './models-fetch.js';
import { probeModel } from './models-probe.js';

const VALID_PROVIDER_TYPES: readonly string[] = LLM_PROVIDER_TYPES;

const RESERVED_HEADER_KEYS = new Set(['authorization', 'content-type', 'host']);

/**
 * Validate user-provided request headers. Returns the normalized object
 * (same shape, no mutation) or throws an Error with a user-facing message.
 *
 * Rules:
 * - Must be an object (not array, not primitive)
 * - All values must be strings
 * - Reserved keys (Authorization, Content-Type, Host — case-insensitive)
 *   are rejected; pi-ai manages those via apiKey + its own client logic
 */
/**
 * Validate user-provided `models` list. Returns the normalized array, or
 * `undefined` when input is null/undefined (so the repository treats it as
 * "no change" rather than "clear to []"). Throws on any structural error.
 *
 * Rules:
 * - `null` / `undefined` → returns `undefined` (no override).
 * - Must be an array. Each entry an object with non-empty string `modelId`.
 * - `modelId` is unique within the list (trim-compared).
 * - `displayName` (optional) is a string.
 * - `contextWindow` / `maxTokens` (optional) are positive integers.
 */
function validateModels(input: unknown): LlmProfileModelEntry[] | undefined {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input)) {
    throw new Error('models must be an array');
  }
  const seen = new Set<string>();
  const out: LlmProfileModelEntry[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`models[${i}] must be an object`);
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.modelId !== 'string' || !entry.modelId.trim()) {
      throw new Error(`models[${i}].modelId is required (non-empty string)`);
    }
    const id = entry.modelId.trim();
    if (seen.has(id)) {
      throw new Error(`models[${i}].modelId "${id}" is duplicated`);
    }
    seen.add(id);
    const normalized: LlmProfileModelEntry = { modelId: id };
    if (entry.displayName !== undefined && entry.displayName !== null) {
      if (typeof entry.displayName !== 'string') {
        throw new Error(`models[${i}].displayName must be a string`);
      }
      normalized.displayName = entry.displayName;
    }
    if (entry.contextWindow !== undefined && entry.contextWindow !== null) {
      const cw = entry.contextWindow;
      if (typeof cw !== 'number' || !Number.isFinite(cw) || cw <= 0 || !Number.isInteger(cw)) {
        throw new Error(`models[${i}].contextWindow must be a positive integer`);
      }
      normalized.contextWindow = cw;
    }
    if (entry.maxTokens !== undefined && entry.maxTokens !== null) {
      const mt = entry.maxTokens;
      if (typeof mt !== 'number' || !Number.isFinite(mt) || mt <= 0 || !Number.isInteger(mt)) {
        throw new Error(`models[${i}].maxTokens must be a positive integer`);
      }
      normalized.maxTokens = mt;
    }
    out.push(normalized);
  }
  return out;
}

function validateRequestHeaders(input: unknown): Record<string, string> {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('requestHeaders must be a JSON object');
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new Error(`requestHeaders["${key}"] must be a string`);
    }
    if (RESERVED_HEADER_KEYS.has(key.toLowerCase())) {
      throw new Error(`Header "${key}" is reserved (managed by API key / pi-ai); remove it from requestHeaders`);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Build a synthetic {@link LlmProfileConfig} from a request body for the
 * pre-save preview endpoints. The id/timestamps are placeholders — neither
 * `fetchModelsForProfile` nor `probeModel` query the DB by id, so this keeps
 * the type happy without persisting anything.
 *
 * Returns the config or a structured error so the caller can 400 cleanly.
 */
function buildPreviewProfile(body: unknown):
  | { ok: true; profile: LlmProfileConfig }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'request body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;

  const providerType = typeof b.providerType === 'string' ? b.providerType : '';
  if (!providerType || !VALID_PROVIDER_TYPES.includes(providerType)) {
    return { ok: false, error: `providerType is required and must be one of: ${VALID_PROVIDER_TYPES.join(', ')}` };
  }

  if (b.baseUrl !== undefined && b.baseUrl !== null && typeof b.baseUrl !== 'string') {
    return { ok: false, error: 'baseUrl must be a string' };
  }
  if (b.apiKey !== undefined && b.apiKey !== null && typeof b.apiKey !== 'string') {
    return { ok: false, error: 'apiKey must be a string' };
  }

  let requestHeaders: Record<string, string> | undefined;
  try {
    const validated = validateRequestHeaders(b.requestHeaders);
    requestHeaders = Object.keys(validated).length > 0 ? validated : undefined;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  let models: LlmProfileModelEntry[] | undefined;
  try {
    models = validateModels(b.models);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const profile: LlmProfileConfig = {
    id: '',                  // preview: never persisted, no DB lookup uses it
    name: '',                // preview: cosmetic; fetch/probe ignore it
    providerType,
    baseUrl: typeof b.baseUrl === 'string' ? b.baseUrl : undefined,
    apiKey: typeof b.apiKey === 'string' ? b.apiKey : undefined,
    requestHeaders,
    models,
    createdAt: 0,
    updatedAt: 0,
  };
  return { ok: true, profile };
}

export function createLlmProfileRoutes(db: Database.Database): Router {
  const router = Router();
  const repo = new LlmProfileRepository(db);
  const deletionService = new LlmProfileDeletionService(db);

  // Pre-save preview endpoints. Registered BEFORE any `:id` route so the
  // literal `models` segment isn't captured as a profile id.

  router.post('/models/fetch-preview', async (req: Request, res: Response) => {
    const built = buildPreviewProfile(req.body);
    if (!built.ok) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: built.error },
      });
      return;
    }
    try {
      const result = await fetchModelsForProfile(built.profile);
      if (!result.ok) {
        res.status(502).json({
          success: false,
          error: { code: 'UPSTREAM_ERROR', message: result.error },
        });
        return;
      }
      res.json({ success: true, data: { models: result.models } });
    } catch (error) {
      console.error('Error fetching preview models for llm profile:', error);
      res.status(500).json({
        success: false,
        error: { code: 'FETCH_ERROR', message: 'Failed to fetch models' },
      });
    }
  });

  router.post('/models/probe-preview', async (req: Request, res: Response) => {
    const built = buildPreviewProfile(req.body);
    if (!built.ok) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: built.error },
      });
      return;
    }
    const modelId = typeof req.body?.modelId === 'string' ? req.body.modelId.trim() : '';
    if (!modelId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'modelId is required' },
      });
      return;
    }
    try {
      const result = await probeModel(built.profile, modelId);
      // Mirror /:id/models/probe: probe failures are diagnostic so we return
      // 200 with data.ok=false rather than a 5xx.
      if (!result.ok) {
        res.json({ success: true, data: { ok: false, error: result.error } });
        return;
      }
      res.json({ success: true, data: { ok: true, latencyMs: result.latencyMs } });
    } catch (error) {
      console.error('Error probing preview model for llm profile:', error);
      res.status(500).json({
        success: false,
        error: { code: 'PROBE_ERROR', message: 'Failed to probe model' },
      });
    }
  });

  router.get('/', (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: repo.findAllOrdered() } as ApiResponse<LlmProfileConfig[]>);
    } catch (error) {
      console.error('Error fetching llm profiles:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch llm profiles' },
      });
    }
  });

  router.get('/:id', (req: Request, res: Response) => {
    try {
      const profile = repo.findById(req.params.id);

      if (!profile) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'LlmProfile not found' },
        });
        return;
      }

      res.json({ success: true, data: profile } as ApiResponse<LlmProfileConfig>);
    } catch (error) {
      console.error('Error fetching llm profile:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch llm profile' },
      });
    }
  });

  router.post('/', (req: Request, res: Response) => {
    try {
      const { name, providerType = 'anthropic', baseUrl, apiKey, compat, requestHeaders: rawRequestHeaders, models: rawModels, isDefault } = req.body;

      if (!name) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Name is required' },
        });
        return;
      }

      if (providerType && !VALID_PROVIDER_TYPES.includes(providerType)) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Invalid provider type. Must be one of: ${VALID_PROVIDER_TYPES.join(', ')}` },
        });
        return;
      }

      let requestHeaders: Record<string, string> | undefined;
      try {
        const validated = validateRequestHeaders(rawRequestHeaders);
        requestHeaders = Object.keys(validated).length > 0 ? validated : undefined;
      } catch (err) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: err instanceof Error ? err.message : String(err) },
        });
        return;
      }

      let validatedModels: LlmProfileModelEntry[] | undefined;
      try {
        validatedModels = validateModels(rawModels);
      } catch (err) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: err instanceof Error ? err.message : String(err) },
        });
        return;
      }

      if (isDefault) {
        repo.clearAllDefaults();
      }

      const profile = repo.create({
        name,
        providerType,
        baseUrl,
        apiKey,
        compat,
        requestHeaders,
        models: validatedModels,
        isDefault: Boolean(isDefault),
      });

      res.status(201).json({ success: true, data: profile } as ApiResponse<LlmProfileConfig>);
    } catch (error) {
      console.error('Error creating llm profile:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to create llm profile' },
      });
    }
  });

  router.put('/:id', (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};

      if (body.providerType && !VALID_PROVIDER_TYPES.includes(body.providerType)) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Invalid provider type. Must be one of: ${VALID_PROVIDER_TYPES.join(', ')}` },
        });
        return;
      }

      if (body.isDefault === true) {
        repo.clearDefaultsExcept(req.params.id);
      }

      const patch: Partial<LlmProfileConfig> = {};
      if (Object.prototype.hasOwnProperty.call(body, 'name')) patch.name = body.name ?? null;
      if (Object.prototype.hasOwnProperty.call(body, 'providerType')) patch.providerType = body.providerType ?? null;
      if (Object.prototype.hasOwnProperty.call(body, 'baseUrl')) patch.baseUrl = body.baseUrl ?? null;
      if (Object.prototype.hasOwnProperty.call(body, 'apiKey')) patch.apiKey = body.apiKey ?? null;
      if (Object.prototype.hasOwnProperty.call(body, 'compat')) patch.compat = body.compat ?? null;
      if (Object.prototype.hasOwnProperty.call(body, 'requestHeaders')) {
        try {
          const validated = validateRequestHeaders(body.requestHeaders);
          patch.requestHeaders = Object.keys(validated).length > 0 ? validated : undefined;
        } catch (err) {
          res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: err instanceof Error ? err.message : String(err) },
          });
          return;
        }
      }
      if (Object.prototype.hasOwnProperty.call(body, 'models')) {
        try {
          patch.models = validateModels(body.models);
        } catch (err) {
          res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: err instanceof Error ? err.message : String(err) },
          });
          return;
        }
      }
      if (Object.prototype.hasOwnProperty.call(body, 'isDefault')) patch.isDefault = Boolean(body.isDefault);

      try {
        repo.update(req.params.id, patch);
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'LlmProfile not found' },
          });
          return;
        }
        throw error;
      }

      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error updating llm profile:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to update llm profile' },
      });
    }
  });

  router.delete('/:id', (req: Request, res: Response) => {
    try {
      deletionService.deleteLlmProfile(req.params.id);
      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      if (error instanceof LlmProfileNotFoundError) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: error.message },
        });
        return;
      }
      if (error instanceof LlmProfileInUseError) {
        res.status(409).json({
          success: false,
          error: {
            code: 'IN_USE',
            message: error.message,
            agentCount: error.agentCount,
          },
        });
        return;
      }
      console.error('Error deleting llm profile:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to delete llm profile' },
      });
    }
  });

  router.post('/:id/set-default', (req: Request, res: Response) => {
    try {
      if (!repo.findById(req.params.id)) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'LlmProfile not found' },
        });
        return;
      }

      res.json({ success: true, data: repo.setDefault(req.params.id) } as ApiResponse<LlmProfileConfig>);
    } catch (error) {
      console.error('Error setting default llm profile:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to set default llm profile' },
      });
    }
  });

  router.post('/:id/models/fetch', async (req: Request, res: Response) => {
    try {
      const profile = repo.findById(req.params.id);
      if (!profile) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'LlmProfile not found' },
        });
        return;
      }
      const result = await fetchModelsForProfile(profile);
      if (!result.ok) {
        res.status(502).json({
          success: false,
          error: { code: 'UPSTREAM_ERROR', message: result.error },
        });
        return;
      }
      res.json({ success: true, data: { models: result.models } });
    } catch (error) {
      console.error('Error fetching models for llm profile:', error);
      res.status(500).json({
        success: false,
        error: { code: 'FETCH_ERROR', message: 'Failed to fetch models' },
      });
    }
  });

  router.post('/:id/models/probe', async (req: Request, res: Response) => {
    try {
      const profile = repo.findById(req.params.id);
      if (!profile) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'LlmProfile not found' },
        });
        return;
      }
      const modelId = typeof req.body?.modelId === 'string' ? req.body.modelId.trim() : '';
      if (!modelId) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'modelId is required' },
        });
        return;
      }
      const result = await probeModel(profile, modelId);
      // Probe failures are diagnostic — return 200 with `data.ok: false`
      // so the UI can render the error inline next to the row rather than
      // surfacing a generic toast.
      if (!result.ok) {
        res.json({ success: true, data: { ok: false, error: result.error } });
        return;
      }
      res.json({ success: true, data: { ok: true, latencyMs: result.latencyMs } });
    } catch (error) {
      console.error('Error probing model for llm profile:', error);
      res.status(500).json({
        success: false,
        error: { code: 'PROBE_ERROR', message: 'Failed to probe model' },
      });
    }
  });

  return router;
}
