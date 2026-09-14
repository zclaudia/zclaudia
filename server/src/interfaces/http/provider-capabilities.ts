import { normalizeAgentRuntimeType, PI_AGENT_RUNTIME } from '@zclaudia/shared/core/agent-profile';
import { type Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import type { ProviderCapabilities } from '@zclaudia/shared/core/runtime-capabilities';

const PI_CAPABILITIES: ProviderCapabilities = {
  modeLabel: 'Mode',
  defaultModeId: 'default',
  modes: [
    { id: 'default', label: 'Default', description: 'Normal coding turns' },
    { id: 'plan', label: 'Plan', description: 'Read-only planning turns (no edits / no shell)' },
  ],
  modelLabel: 'Runtime',
  models: [],
  supportsAIReview: true,
};

const CLAUDE_CAPABILITIES: ProviderCapabilities = {
  modeLabel: 'Mode',
  defaultModeId: 'default',
  modes: [
    { id: 'default', label: 'Default', description: 'Normal Claude Code turns' },
    { id: 'plan', label: 'Plan', description: 'Claude plan mode' },
  ],
  modelLabel: 'Model',
  models: [],
  supportsAIReview: false,
};

const CURSOR_CAPABILITIES: ProviderCapabilities = {
  modeLabel: 'Mode',
  defaultModeId: 'default',
  modes: [
    {
      id: 'default',
      label: 'Default',
      description: 'Cursor auto-review: safe tool calls run, destructive ones are declined',
    },
    { id: 'plan', label: 'Plan', description: 'Cursor plan mode' },
    { id: 'ask', label: 'Ask', description: 'Cursor ask (read-oriented) mode' },
    {
      id: 'bypassPermissions',
      label: 'Bypass',
      description: 'Cursor runs every tool call without review',
    },
  ],
  modelLabel: 'Model',
  models: [],
  supportsAIReview: false,
  supportsPermissionOverrides: false,
};

const CODEX_CAPABILITIES: ProviderCapabilities = {
  modeLabel: 'Mode',
  defaultModeId: 'default',
  modes: [
    { id: 'default', label: 'Default', description: 'Supervised Codex turns' },
    { id: 'plan', label: 'Plan', description: 'Read-only planning (decline writes)' },
    { id: 'acceptEdits', label: 'Accept Edits', description: 'Auto-accept file changes' },
    { id: 'bypassPermissions', label: 'Bypass', description: 'Auto-accept approvals' },
  ],
  modelLabel: 'Model',
  models: [],
  supportsAIReview: false,
};

const RUNTIME_CAPABILITIES: Record<string, ProviderCapabilities> = {
  [PI_AGENT_RUNTIME]: PI_CAPABILITIES,
  claude: CLAUDE_CAPABILITIES,
  cursor: CURSOR_CAPABILITIES,
  codex: CODEX_CAPABILITIES,
};

export function capabilitiesForSession(
  runtimeType: string,
  supportsPermissionOverrides: boolean
): ProviderCapabilities {
  const base = RUNTIME_CAPABILITIES[normalizeAgentRuntimeType(runtimeType)] ?? PI_CAPABILITIES;
  if (runtimeType !== 'cursor' || !supportsPermissionOverrides)
    return { ...base, supportsPermissionOverrides };
  return {
    ...base,
    supportsPermissionOverrides: true,
    modes: base.modes.map(mode =>
      mode.id === 'default'
        ? { ...mode, description: 'Tool approval requests are reviewed by ZClaudia' }
        : mode
    ),
  };
}

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
