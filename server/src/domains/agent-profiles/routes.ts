import {
  normalizeAgentRuntimeType,
  DEFAULT_AGENT_RUNTIME,
} from '@zclaudia/shared/core/agent-profile';
import { Router } from 'express';
import type { Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { AgentProfileConfig, ThinkingLevel } from '@zclaudia/shared/core/agent-profile';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import { AgentProfileRepository } from './repository.js';
import { LlmProfileRepository } from '../llm-profiles/repository.js';
import {
  AgentProfileDeletionService,
  AgentProfileNotFoundError,
} from './agent-profile-deletion-service.js';
import {
  resolveAgentReadinessWithRuntimeCheck,
  resolveAgentExecutionReadiness,
} from '../agent-readiness/check.js';
import { resolveAgentProfileRecordStatus } from '../agent-readiness/record-status.js';
import { isValidRuntimeType, runtimeRequiresLlmProfile } from './runtime-type-guard.js';
import {
  validateEngineModeConfiguration,
  engineModeForResponse,
} from './engine-mode-validation.js';
import { providerRegistry } from '../../infra/providers/registry.js';

const VALID_THINKING_LEVELS: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

function validateRuntimeType(input: unknown): string | undefined | null {
  if (input === undefined) return undefined;
  if (typeof input !== 'string' || !isValidRuntimeType(input)) {
    return null;
  }
  return normalizeAgentRuntimeType(input);
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

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const data = await Promise.all(
        repo.findAllOrdered().map(async agent => {
          const llm = agent.llmProfileId ? llmRepo.findById(agent.llmProfileId) : undefined;
          const recordStatus = resolveAgentProfileRecordStatus(agent, llm);
          const readiness = await resolveAgentExecutionReadiness(agent, llm);
          if (!readiness.usable && readiness.reason?.startsWith('runtime_')) {
            recordStatus.availability = {
              usable: false,
              reason:
                readiness.reason === 'runtime_auth_required' ? 'needs_auth' : 'requirement_unmet',
            };
          }
          // API responses expose the normalized engine mode (declared default
          // when the column is NULL) and null (never '') for "no binding".
          return {
            ...agent,
            engineMode: engineModeForResponse(agent),
            llmProfileId: agent.llmProfileId ?? null,
            recordStatus,
          };
        })
      );
      res.json({ success: true, data } as ApiResponse<AgentProfileConfig[]>);
    } catch (error) {
      console.error('Error fetching agent profiles:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch agent profiles' },
      });
    }
  });

  router.get('/readiness', async (_req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        data: await resolveAgentReadinessWithRuntimeCheck(db),
      } as ApiResponse<Awaited<ReturnType<typeof resolveAgentReadinessWithRuntimeCheck>>>);
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
      const withStatus = {
        ...profile,
        engineMode: engineModeForResponse(profile),
        llmProfileId: profile.llmProfileId ?? null,
        recordStatus: resolveAgentProfileRecordStatus(
          profile,
          profile.llmProfileId ? llmRepo.findById(profile.llmProfileId) : undefined
        ),
      };
      res.json({ success: true, data: withStatus } as ApiResponse<AgentProfileConfig>);
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
        engineMode,
        cliPath,
        isDefault,
      } = req.body ?? {};

      if (!name || typeof name !== 'string') {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'name is required' },
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
      if (engineMode !== undefined && engineMode !== null && typeof engineMode !== 'string') {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'engineMode must be a string' },
        });
        return;
      }
      const validatedRuntimeType = validateRuntimeType(runtimeType);
      if (validatedRuntimeType === null) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid runtimeType. Must be one of: ${providerRegistry.listTypes().join(', ')}`,
          },
        });
        return;
      }
      const resolvedRuntimeType = validatedRuntimeType ?? DEFAULT_AGENT_RUNTIME;
      if (model !== undefined && model !== null && typeof model !== 'string') {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'model must be a string' },
        });
        return;
      }
      const normalizedModel = typeof model === 'string' ? model.trim() : '';
      if (runtimeRequiresLlmProfile(resolvedRuntimeType) && !normalizedModel) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'model is required' },
        });
        return;
      }
      if (cliPath !== undefined && cliPath !== null && typeof cliPath !== 'string') {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'cliPath must be a string' },
        });
        return;
      }
      const normalizedCliPath = typeof cliPath === 'string' ? cliPath.trim() : undefined;

      // Legacy payloads may pass llmProfileId: '' — normalize to "no binding".
      const requestedLlmProfileId =
        typeof llmProfileId === 'string' && llmProfileId.trim() ? llmProfileId.trim() : null;

      const requiresLlmProfile = runtimeRequiresLlmProfile(resolvedRuntimeType);
      if (requiresLlmProfile && !requestedLlmProfileId) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'llmProfileId is required' },
        });
        return;
      }

      if (requestedLlmProfileId && !llmRepo.findById(requestedLlmProfileId)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `llmProfileId not found: ${requestedLlmProfileId}`,
          },
        });
        return;
      }

      // Engine-mode rules validate the whole configuration (mode + binding +
      // model + cli path + protocol admission) as one atomic unit.
      const engineModeValidation = validateEngineModeConfiguration({
        runtimeType: resolvedRuntimeType,
        requestedEngineMode: typeof engineMode === 'string' ? engineMode : null,
        engineModeExplicit: engineMode !== undefined && engineMode !== null,
        mergedLlmProfileId: requestedLlmProfileId,
        mergedModel: normalizedModel,
        mergedCliPath: normalizedCliPath ?? null,
        llmRepo,
      });
      if (!engineModeValidation.ok) {
        res.status(engineModeValidation.status).json({
          success: false,
          error: { code: engineModeValidation.code, message: engineModeValidation.message },
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
        engineMode: engineModeValidation.engineMode || undefined,
        llmProfileId:
          engineModeValidation.llmProfileId ?? (requiresLlmProfile ? requestedLlmProfileId : null),
        model: normalizedModel,
        cliPath: normalizedCliPath,
        systemPrompt: typeof systemPrompt === 'string' ? systemPrompt : '',
        enabledTools: Array.isArray(enabledTools) ? enabledTools : [],
        toolSelection,
        skillSelection,
        skillExecution,
        multimodalFallback: validatedFallback.value ?? undefined,
        thinkingLevel: thinkingLevel ?? undefined,
        runtimeType: resolvedRuntimeType,
        isDefault: Boolean(isDefault),
      });

      res.status(201).json({
        success: true,
        data: {
          ...profile,
          engineMode: engineModeForResponse(profile),
          llmProfileId: profile.llmProfileId ?? null,
        },
      } as ApiResponse<AgentProfileConfig>);
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

      if (
        Object.prototype.hasOwnProperty.call(body, 'engineMode') &&
        body.engineMode !== null &&
        typeof body.engineMode !== 'string'
      ) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'engineMode must be a string' },
        });
        return;
      }

      const validatedRuntimeType = validateRuntimeType(body.runtimeType);
      if (validatedRuntimeType === null) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid runtimeType. Must be one of: ${providerRegistry.listTypes().join(', ')}`,
          },
        });
        return;
      }
      if (
        Object.prototype.hasOwnProperty.call(body, 'model') &&
        body.model !== undefined &&
        body.model !== null &&
        typeof body.model !== 'string'
      ) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'model must be a string' },
        });
        return;
      }
      if (
        Object.prototype.hasOwnProperty.call(body, 'cliPath') &&
        body.cliPath !== undefined &&
        body.cliPath !== null &&
        typeof body.cliPath !== 'string'
      ) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'cliPath must be a string' },
        });
        return;
      }

      if (body.llmProfileId !== undefined && body.llmProfileId !== '') {
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

      const existing = repo.findById(req.params.id);
      if (!existing) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'AgentProfile not found' },
        });
        return;
      }
      // A readonly profile is frozen — its lifecycle is driven by delete/restore, not PATCH.
      if (existing.status === 'readonly') {
        res.status(409).json({
          success: false,
          error: {
            code: 'READONLY',
            message: 'Cannot edit a read-only agent profile',
          },
        });
        return;
      }

      // Merge the patch onto the stored profile first: engine-mode rules
      // validate the resulting configuration as a whole, so a partial update
      // (e.g. an old editor clearing the model) cannot produce an SDK profile
      // without its required binding, and omitted fields keep their values.
      const mergedRuntimeType =
        validatedRuntimeType !== undefined
          ? validatedRuntimeType
          : normalizeAgentRuntimeType(existing.runtimeType);
      const engineModeInBody = Object.prototype.hasOwnProperty.call(body, 'engineMode');
      const mergedEngineMode = engineModeInBody ? body.engineMode : (existing.engineMode ?? null);
      const mergedLlmProfileId = Object.prototype.hasOwnProperty.call(body, 'llmProfileId')
        ? typeof body.llmProfileId === 'string' && body.llmProfileId.trim()
          ? body.llmProfileId.trim()
          : null
        : (existing.llmProfileId ?? null);
      const mergedModel = Object.prototype.hasOwnProperty.call(body, 'model')
        ? typeof body.model === 'string'
          ? body.model.trim()
          : ''
        : existing.model;
      const mergedCliPath = Object.prototype.hasOwnProperty.call(body, 'cliPath')
        ? typeof body.cliPath === 'string'
          ? body.cliPath.trim()
          : null
        : (existing.cliPath ?? null);

      const engineModeValidation = validateEngineModeConfiguration({
        runtimeType: mergedRuntimeType,
        requestedEngineMode: typeof mergedEngineMode === 'string' ? mergedEngineMode : null,
        engineModeExplicit: engineModeInBody,
        mergedLlmProfileId,
        mergedModel,
        mergedCliPath,
        llmRepo,
      });
      if (!engineModeValidation.ok) {
        res.status(engineModeValidation.status).json({
          success: false,
          error: { code: engineModeValidation.code, message: engineModeValidation.message },
        });
        return;
      }

      const patch: Partial<Omit<AgentProfileConfig, 'id' | 'createdAt' | 'updatedAt'>> & {
        cliPath?: string | null;
      } = {};
      if (Object.prototype.hasOwnProperty.call(body, 'name')) patch.name = body.name;
      if (Object.prototype.hasOwnProperty.call(body, 'description'))
        patch.description = body.description ?? undefined;
      if (engineModeValidation.engineMode) {
        patch.engineMode = engineModeValidation.engineMode;
      } else if (engineModeInBody) {
        // Runtimes without declared modes only accept an unset engine mode.
        res.status(400).json({
          success: false,
          error: {
            code: 'ENGINE_MODE_UNSUPPORTED',
            message: `Runtime "${mergedRuntimeType}" does not support engine modes`,
          },
        });
        return;
      }
      if (
        engineModeInBody ||
        engineModeValidation.llmProfileIdForced ||
        Object.prototype.hasOwnProperty.call(body, 'llmProfileId')
      ) {
        patch.llmProfileId = engineModeValidation.llmProfileId;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'model'))
        patch.model = typeof body.model === 'string' ? body.model.trim() : '';
      if (Object.prototype.hasOwnProperty.call(body, 'cliPath'))
        patch.cliPath = typeof body.cliPath === 'string' ? body.cliPath.trim() : null;
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
      res.json({
        success: true,
        data: {
          ...updated,
          engineMode: engineModeForResponse(updated),
          llmProfileId: updated.llmProfileId ?? null,
        },
      } as ApiResponse<AgentProfileConfig>);
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
      const result = deletionService.deleteAgentProfile(req.params.id);
      // Hard-delete → 200 {success:true}. Archived → 200 {success:true, data:{archived,sessionCount}}.
      // Unified 200 so the client always reaches the success branch and branches on `data.archived`.
      if (result.archived) {
        res.json({
          success: true,
          data: { archived: true, sessionCount: result.sessionCount },
        } as ApiResponse<{ archived: true; sessionCount: number }>);
      } else {
        res.json({ success: true } as ApiResponse<void>);
      }
    } catch (error) {
      if (error instanceof AgentProfileNotFoundError) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: error.message },
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

  router.post('/:id/restore', (req: Request, res: Response) => {
    try {
      if (!repo.findById(req.params.id)) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'AgentProfile not found' },
        });
        return;
      }
      repo.restore(req.params.id);
      const restored = repo.findById(req.params.id);
      if (!restored) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'AgentProfile not found' },
        });
        return;
      }
      res.json({ success: true, data: restored } as ApiResponse<AgentProfileConfig>);
    } catch (error) {
      console.error('Error restoring agent profile:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to restore agent profile' },
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
