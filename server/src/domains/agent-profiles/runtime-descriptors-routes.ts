import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import { runtimeDescriptorRegistry } from '../../infra/providers/runtime-descriptor-registry.js';
import { pluginLoader } from '../../application/plugins/loader.js';
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
}

export function createRuntimeDescriptorRoutes(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    try {
      const descriptors = new Map(runtimeDescriptorRegistry.list().map(d => [d.type, d]));
      for (const plugin of pluginLoader.getPlugins()) {
        if (!pluginLoader.isBuiltin(plugin.manifest.id)) continue;
        for (const descriptor of plugin.manifest.contributes?.agentRuntimes ?? []) {
          if (!descriptors.has(descriptor.type)) descriptors.set(descriptor.type, descriptor);
        }
      }
      const data: AgentRuntimeSummary[] = [...descriptors.values()].map(d => ({
        runtime: d.type,
        label: d.label,
        enabled: providerRegistry.hasType(d.type),
        model: d.model,
        hasCliPath: d.hasCliPath,
        capabilities: d.capabilities,
        authNote: d.authNote,
      }));
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
