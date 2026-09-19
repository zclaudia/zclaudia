import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import {
  defaultEngineModeFor,
  projectEngineMode,
  type EngineModeSummary,
  type ProfileConfigDescriptor,
} from '@zclaudia/shared/core/profile-config-descriptor';
import type { AgentRuntimeContribution } from '@zclaudia/shared/providers';
import { runtimeDescriptorRegistry } from '../../infra/providers/runtime-descriptor-registry.js';
import { providerRegistry } from '../../infra/providers/registry.js';

export interface AgentRuntimeSummary {
  runtime: string;
  label: string;
  enabled: boolean;
  model: {
    kind: string;
    multimodalFallback: boolean;
    thinkingLevel: string;
  };
  hasCliPath: boolean;
  capabilities: {
    tools: string;
    providers: string;
    skills: string;
  };
  authNote?: string;
  /** Declared engine modes (absent for legacy single-mode runtimes). */
  defaultEngineMode?: string;
  engineModes?: EngineModeSummary[];
}

export interface RuntimeDescriptorRoutesDeps {
  /**
   * Agent runtime descriptors contributed by built-in plugins. Supplied by
   * the composition root (which reads the plugin loader) so this domain
   * module does not import the application layer. Evaluated per request.
   */
  builtinRuntimeContributions?: () => AgentRuntimeContribution[];
}

export function createRuntimeDescriptorRoutes(deps: RuntimeDescriptorRoutesDeps = {}): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    try {
      const descriptors = new Map(runtimeDescriptorRegistry.list().map(d => [d.type, d]));
      for (const descriptor of deps.builtinRuntimeContributions?.() ?? []) {
        if (!descriptors.has(descriptor.type)) descriptors.set(descriptor.type, descriptor);
      }
      const data: AgentRuntimeSummary[] = [...descriptors.values()].map(d => {
        const base: AgentRuntimeSummary = {
          runtime: d.type,
          label: d.label,
          enabled: providerRegistry.hasType(d.type),
          model: d.model,
          hasCliPath: d.hasCliPath,
          capabilities: d.capabilities,
          authNote: d.authNote,
        };
        if (!d.engineModes || d.engineModes.length === 0) return base;
        // Dual-mode runtimes expose per-mode projections; the default mode's
        // projection stays consistent with the legacy top-level fields above.
        return {
          ...base,
          defaultEngineMode: defaultEngineModeFor(d) ?? undefined,
          engineModes: d.engineModes.map(mode => ({
            id: mode.id,
            label: mode.label,
            descriptor: (({
              runtime: _runtime,
              label: _label,
              enabled: _enabled,
              defaultEngineMode: _defaultEngineMode,
              engineModes: _engineModes,
              ...rest
            }) => rest)(projectEngineMode(mode, d.type, d.label)),
            connection: mode.connection,
            executable: mode.executable,
            authNote: mode.authNote,
          })),
        };
      });
      res.json({ success: true, data } as ApiResponse<AgentRuntimeSummary[]>);
    } catch (error) {
      console.error('Error fetching agent runtimes:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch agent runtimes' },
      });
    }
  });

  return router;
}
