import { normalizeAgentRuntimeType } from '@zclaudia/shared/core/agent-profile';
import { type Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import type { ProviderCapabilities } from '@zclaudia/shared/core/runtime-capabilities';
import { PI_CAPABILITIES, RUNTIME_CAPABILITIES } from '../../utils/runtime-capabilities.js';

// Pure capability tables live in utils/runtime-capabilities.ts; re-exported
// here for existing import sites.
export { capabilitiesForSession } from '../../utils/runtime-capabilities.js';

export function mountCapabilityRoutes(router: Router, db: Database.Database): void {
  router.get('/type/:type/capabilities', (req: Request, res: Response) => {
    const capabilities = RUNTIME_CAPABILITIES[normalizeAgentRuntimeType(req.params.type)];
    if (!capabilities) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Runtime type not found' },
      });
      return;
    }

    res.json({ success: true, data: capabilities } as ApiResponse<ProviderCapabilities>);
  });

  router.get('/:id/capabilities', (req: Request, res: Response) => {
    const row = db.prepare('SELECT id FROM llm_profiles WHERE id = ?').get(req.params.id) as
      | { id: string }
      | undefined;

    if (!row) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Runtime config not found' },
      });
      return;
    }

    // LLM-profile capabilities remain Pi capabilities until callers ask
    // by agent profile/runtime type. This route receives an LLM profile id, not
    // an Agent profile id.
    res.json({ success: true, data: PI_CAPABILITIES } as ApiResponse<ProviderCapabilities>);
  });
}
