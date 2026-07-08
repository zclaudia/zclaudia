import { Router } from 'express';
import type { Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type {
  AgentProfileConfig,
  AgentRuntimeType,
  ThinkingLevel,
} from '@zclaudia/shared/core/agent-profile';
import { AGENT_RUNTIME_TYPES } from '@zclaudia/shared/core/agent-profile';
import { runtimeRequiresLlmProfile } from '@zclaudia/shared/core/profile-config-descriptor';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import { AgentProfileRepository } from './repository.js';
import { LlmProfileRepository } from '../llm-profiles/repository.js';
import {
  AgentProfileDeletionService,
  AgentProfileInUseError,
  AgentProfileNotFoundError,
} from './agent-profile-deletion-service.js';
import { resolveAgentReadiness } from '../agent-readiness/check.js';

const VALID_THINKING_LEVELS: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

const VALID_RUNTIME_TYPES: readonly AgentRuntimeType[] = AGENT_RUNTIME_TYPES;

function validateRuntimeType(input: unknown): AgentRuntimeType | undefined | null {
  if (input === undefined) return undefined;
  if (typeof input !== 'string' || !VALID_RUNTIME_TYPES.includes(input as AgentRuntimeType)) {
    return null;
  }
  return input as AgentRuntimeType;
}

type MultimodalFallbackValidation =
  | { ok: true; value: AgentProfileConfig['multimodalFallback'] | null | undefined }
  | { ok: false; error: string };

function validateMultimodalFallback(
  llmRepo: LlmProfileRepository,
  input: unknown,
  options: { allowNull: boolean }
): MultimodalFallbackValidation {
  if (input === undefined) return { ok: true, value: undefined };
  if (input === null) return { ok: true, value: options.allowNull ? null : undefined };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'multimodalFallback must be an object or null' };
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.llmProfileId !== 'string' || !raw.llmProfileId.trim()) {
    return { ok: false, error: 'multimodalFallback.llmProfileId is required' };
  }
  if (typeof raw.model !== 'string' || !raw.model.trim()) {
    return { ok: false, error: 'multimodalFallback.model is required' };
  }

  const fallback = {
    llmProfileId: raw.llmProfileId.trim(),
    model: raw.model.trim(),
  };
  const llm = llmRepo.findById(fallback.llmProfileId);
  if (!llm) {
    return {
      ok: false,
      error: `multimodalFallback.llmProfileId not found: ${fallback.llmProfileId}`,
    };
  }
  const declaredModels = llm.models ?? [];
  if (declaredModels.length > 0) {
    const entry = declaredModels.find(model => model.modelId === fallback.model);
    if (!entry) {
      return {
        ok: false,
        error: `multimodalFallback.model not found on LLM profile: ${fallback.model}`,
      };
    }
    if (entry.inputModalities && !entry.inputModalities.includes('image')) {
      return {
        ok: false,
        error: `multimodalFallback.model must support image input: ${fallback.model}`,
      };
    }
  }
  return { ok: true, value: fallback };
}

export function createAgentProfileRoutes(db: Database.Database): Router {
  const router = Router();
  const repo = new AgentProfileRepository(db);
  const llmRepo = new LlmProfileRepository(db);
  const deletionService = new AgentProfileDeletionService(db);

  router.get('/', (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: repo.findAllOrdered() } as ApiResponse<AgentProfileConfig[]>);
    } catch (error) {
      console.error('Error fetching agent profiles:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch agent profiles' },
      });
    }
  });

  router.get('/readiness', (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: resolveAgentReadiness(db) } as ApiResponse<
        ReturnType<typeof resolveAgentReadiness>
      >);
    } catch (error) {
      console.error('Error checking agent readiness:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to check agent readiness' },
      });
    }
  });

  router.get('/:id', (req: Request, res: Response) => {
    try {
      const profile = repo.findById(req.params.id);
      if (!profile) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'AgentProfile not found' },
        });
        return;
      }
      res.json({ success: true, data: profile } as ApiResponse<AgentProfileConfig>);
    } catch (error) {
      console.error('Error fetching agent profile:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch agent profile' },
      });
    }
  });

  router.post('/', (req: Request, res: Response) => {
    try {
      const {
        name,
        description,
        llmProfileId,
        model,
        systemPrompt,
        enabledTools,
        toolSelection,
        skillSelection,
        skillExecution,
        multimodalFallback,
        thinkingLevel,
        runtimeType,
        isDefault,
      } = req.body ?? {};

      if (!name || typeof name !== 'string') {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'name is required' },
        });
        return;
      }
      if (!model || typeof model !== 'string') {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'model is required' },
        });
        return;
      }
      if (toolSelection === undefined && !Array.isArray(enabledTools)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'enabledTools must be an array when toolSelection is absent',
          },
        });
        return;
      }
      if (
        thinkingLevel !== undefined &&
        thinkingLevel !== null &&
        !VALID_THINKING_LEVELS.includes(thinkingLevel)
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid thinkingLevel. Must be one of: ${VALID_THINKING_LEVELS.join(', ')}`,
          },
        });
        return;
      }
      const validatedRuntimeType = validateRuntimeType(runtimeType);
      if (validatedRuntimeType === null) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid runtimeType. Must be one of: ${VALID_RUNTIME_TYPES.join(', ')}`,
          },
        });
        return;
      }

      const requiresLlmProfile = runtimeRequiresLlmProfile(validatedRuntimeType ?? 'zclaudia');
      if (requiresLlmProfile && (!llmProfileId || typeof llmProfileId !== 'string')) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'llmProfileId is required' },
        });
        return;
      }

      if (llmProfileId && !llmRepo.findById(llmProfileId)) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `llmProfileId not found: ${llmProfileId}` },
        });
        return;
      }

      const validatedFallback = validateMultimodalFallback(llmRepo, multimodalFallback, {
        allowNull: false,
      });
      if (!validatedFallback.ok) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: validatedFallback.error },
        });
        return;
      }

      const profile = repo.createWithDefaultHandling({
        name,
        description,
        llmProfileId: typeof llmProfileId === 'string' ? llmProfileId : '',
        model,
        systemPrompt: typeof systemPrompt === 'string' ? systemPrompt : '',
        enabledTools: Array.isArray(enabledTools) ? enabledTools : [],
        toolSelection,
        skillSelection,
        skillExecution,
        multimodalFallback: validatedFallback.value ?? undefined,
        thinkingLevel: thinkingLevel ?? undefined,
        runtimeType: validatedRuntimeType ?? 'zclaudia',
        isDefault: Boolean(isDefault),
      });

      res.status(201).json({ success: true, data: profile } as ApiResponse<AgentProfileConfig>);
    } catch (error) {
      console.error('Error creating agent profile:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to create agent profile' },
      });
    }
  });

  router.patch('/:id', (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};

      if (
        body.thinkingLevel !== undefined &&
        body.thinkingLevel !== null &&
        !VALID_THINKING_LEVELS.includes(body.thinkingLevel)
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid thinkingLevel. Must be one of: ${VALID_THINKING_LEVELS.join(', ')}`,
          },
        });
        return;
      }

      const validatedRuntimeType = validateRuntimeType(body.runtimeType);
      if (validatedRuntimeType === null) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid runtimeType. Must be one of: ${VALID_RUNTIME_TYPES.join(', ')}`,
          },
        });
        return;
      }

      if (body.llmProfileId !== undefined) {
        if (!llmRepo.findById(body.llmProfileId)) {
          res.status(400).json({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `llmProfileId not found: ${body.llmProfileId}`,
            },
          });
          return;
        }
      }

      let validatedFallback: MultimodalFallbackValidation = { ok: true, value: undefined };
      if (Object.prototype.hasOwnProperty.call(body, 'multimodalFallback')) {
        validatedFallback = validateMultimodalFallback(llmRepo, body.multimodalFallback, {
          allowNull: true,
        });
        if (!validatedFallback.ok) {
          res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: validatedFallback.error },
          });
          return;
        }
      }

      if (!repo.findById(req.params.id)) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'AgentProfile not found' },
        });
        return;
      }

      const patch: Partial<Omit<AgentProfileConfig, 'id' | 'createdAt' | 'updatedAt'>> = {};
      if (Object.prototype.hasOwnProperty.call(body, 'name')) patch.name = body.name;
      if (Object.prototype.hasOwnProperty.call(body, 'description'))
        patch.description = body.description ?? undefined;
      if (Object.prototype.hasOwnProperty.call(body, 'llmProfileId'))
        patch.llmProfileId = body.llmProfileId;
      if (Object.prototype.hasOwnProperty.call(body, 'model')) patch.model = body.model;
      if (Object.prototype.hasOwnProperty.call(body, 'systemPrompt'))
        patch.systemPrompt = body.systemPrompt;
      if (Object.prototype.hasOwnProperty.call(body, 'enabledTools'))
        patch.enabledTools = body.enabledTools;
      if (Object.prototype.hasOwnProperty.call(body, 'toolSelection'))
        patch.toolSelection = body.toolSelection;
      if (Object.prototype.hasOwnProperty.call(body, 'skillSelection'))
        patch.skillSelection = body.skillSelection;
      if (Object.prototype.hasOwnProperty.call(body, 'skillExecution'))
        patch.skillExecution = body.skillExecution;
      if (Object.prototype.hasOwnProperty.call(body, 'multimodalFallback'))
        patch.multimodalFallback = validatedFallback.value as never;
      if (Object.prototype.hasOwnProperty.call(body, 'thinkingLevel'))
        patch.thinkingLevel = body.thinkingLevel ?? undefined;
      if (Object.prototype.hasOwnProperty.call(body, 'runtimeType'))
        patch.runtimeType = validatedRuntimeType === undefined ? undefined : validatedRuntimeType;
      if (Object.prototype.hasOwnProperty.call(body, 'isDefault'))
        patch.isDefault = Boolean(body.isDefault);

      const updated = repo.updateWithDefaultHandling(req.params.id, patch);
      res.json({ success: true, data: updated } as ApiResponse<AgentProfileConfig>);
    } catch (error) {
      console.error('Error updating agent profile:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to update agent profile' },
      });
    }
  });

  router.delete('/:id', (req: Request, res: Response) => {
    try {
      deletionService.deleteAgentProfile(req.params.id);
      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      if (error instanceof AgentProfileNotFoundError) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: error.message },
        });
        return;
      }
      if (error instanceof AgentProfileInUseError) {
        res.status(409).json({
          success: false,
          error: {
            code: 'IN_USE',
            message: error.message,
            sessionCount: error.sessionCount,
          },
        });
        return;
      }
      console.error('Error deleting agent profile:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to delete agent profile' },
      });
    }
  });

  router.post('/:id/set-default', (req: Request, res: Response) => {
    try {
      if (!repo.findById(req.params.id)) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'AgentProfile not found' },
        });
        return;
      }
      res.json({
        success: true,
        data: repo.setDefault(req.params.id),
      } as ApiResponse<AgentProfileConfig>);
    } catch (error) {
      console.error('Error setting default agent profile:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to set default agent profile' },
      });
    }
  });

  return router;
}
