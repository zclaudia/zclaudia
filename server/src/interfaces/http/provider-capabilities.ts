import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import type { ProviderCapabilities } from '@zclaudia/shared/core/runtime-capabilities';

const ZCLAUDIA_CAPABILITIES: ProviderCapabilities = {
  modelLabel: 'Runtime',
  models: [],
  supportsAIReview: false,
};

export function mountCapabilityRoutes(router: Router, db: Database.Database): void {
  router.get('/type/:type/capabilities', (req: Request, res: Response) => {
    if (req.params.type !== 'zclaudia') {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Runtime type not found' },
      });
      return;
    }

    res.json({ success: true, data: ZCLAUDIA_CAPABILITIES } as ApiResponse<ProviderCapabilities>);
  });

  router.get('/:id/capabilities', (req: Request, res: Response) => {
    const row = db.prepare('SELECT id FROM llm_profiles WHERE id = ?')
      .get(req.params.id) as { id: string } | undefined;

    if (!row) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Runtime config not found' },
      });
      return;
    }

    // The runtime is currently always the zclaudia stub regardless of llm
    // provider type; T3/T4 will branch on provider_type when needed.
    res.json({ success: true, data: ZCLAUDIA_CAPABILITIES } as ApiResponse<ProviderCapabilities>);
  });
}
