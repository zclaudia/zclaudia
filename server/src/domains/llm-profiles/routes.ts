import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { LLM_PROVIDER_TYPES } from '@zclaudia/shared/core/llm-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import { LlmProfileRepository } from './repository.js';
import { LlmProfileDeletionService, LlmProfileNotFoundError } from './llm-profile-deletion-service.js';

const VALID_PROVIDER_TYPES: readonly string[] = LLM_PROVIDER_TYPES;

export function createLlmProfileRoutes(db: Database.Database): Router {
  const router = Router();
  const repo = new LlmProfileRepository(db);
  const deletionService = new LlmProfileDeletionService(db);

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
      const { name, providerType = 'anthropic', baseUrl, apiKey, compat, env, isDefault } = req.body;

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

      if (isDefault) {
        repo.clearAllDefaults();
      }

      const profile = repo.create({
        name,
        providerType,
        baseUrl,
        apiKey,
        compat,
        env,
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
      if (Object.prototype.hasOwnProperty.call(body, 'env')) patch.env = body.env ?? null;
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

  return router;
}
