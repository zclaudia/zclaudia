import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import { runtimeDescriptorRegistry } from '../../infra/providers/runtime-descriptor-registry.js';

export interface AgentRuntimeSummary {
  runtime: string;
  label: string;
  enabled: boolean;
  model: {
    kind: string;
    multimodalFallback: boolean;
    thinkingLevel: boolean;
  };
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
      const data: AgentRuntimeSummary[] = runtimeDescriptorRegistry.list().map(d => ({
        runtime: d.type,
        label: d.label,
        enabled: true,
        model: d.model,
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
