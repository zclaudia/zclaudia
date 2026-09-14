import type Database from 'better-sqlite3';
import { normalizeAgentRuntimeType, type ThinkingLevel } from '@zclaudia/shared/core/agent-profile';
import type {
  RuntimeModelCatalog,
  SessionModelSettings,
  SessionModelSelection,
} from '@zclaudia/shared/core/runtime-capabilities';
import { resolveAgentForSession } from '../agent-profiles/agent-resolver.js';
import {
  readSessionModelSelection,
  writeSessionModelSelection,
} from './model-settings-repository.js';
import type { ProviderRegistryPort } from '../../infra/providers/registry.js';
import { managedRuntimeService } from '../../application/managed-runtimes/service.js';

export class ModelSettingsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
const LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
function allowedLevels(runtime: string, levels?: string[]): string[] {
  return (
    levels?.filter(
      level =>
        LEVELS.has(level) &&
        (runtime !== 'codex' || ['low', 'medium', 'high', 'xhigh'].includes(level))
    ) ?? []
  );
}
const caches = new WeakMap<
  Database.Database,
  Map<string, { expires: number; catalog: RuntimeModelCatalog }>
>();

export class SessionModelSettingsService {
  constructor(
    private readonly db: Database.Database,
    private readonly registry: ProviderRegistryPort,
    private readonly isRunning: (sessionId: string) => boolean
  ) {}

  private context(sessionId: string) {
    const row = this.db
      .prepare(
        `SELECT s.agent_profile_id, s.provider_transport, s.sdk_session_id,
      s.is_read_only, s.archived_at, s.type, COALESCE(NULLIF(s.working_directory, ''), p.root_path) AS cwd
      FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=?`
      )
      .get(sessionId) as
      | {
          agent_profile_id: string;
          provider_transport: string | null;
          sdk_session_id: string | null;
          is_read_only: number;
          archived_at: number | null;
          type: string;
          cwd: string;
        }
      | undefined;
    if (!row) throw new ModelSettingsError(404, 'SESSION_NOT_FOUND', 'Session not found');
    const { agent, llm } = resolveAgentForSession(this.db, {
      explicitAgentId: row.agent_profile_id,
      sessionId,
      ignoreModelSelection: true,
    });
    const runtimeType = normalizeAgentRuntimeType(agent.runtimeType);
    const engineMode = agent.engineMode ?? 'cli';
    const transport =
      row.provider_transport ??
      (row.sdk_session_id
        ? 'cursor-stream-json-v1'
        : process.env.ZCLAUDIA_CURSOR_TRANSPORT === 'stream-json'
          ? 'cursor-stream-json-v1'
          : 'cursor-acp-v1');
    return { row, agent, llm, runtimeType, engineMode, transport };
  }

  async read(
    sessionId: string,
    discover = false,
    forceRefresh = false
  ): Promise<SessionModelSettings> {
    const { row, agent, llm, runtimeType, engineMode, transport } = this.context(sessionId);
    const profileModels = engineMode === 'sdk' || runtimeType === 'pi';
    const legacyCursor = runtimeType === 'cursor' && transport === 'cursor-stream-json-v1';
    const selection = readSessionModelSelection(this.db, sessionId);
    const result: SessionModelSettings = {
      selection,
      runtimeType,
      engineMode,
      inheritedModel: agent.model,
      inheritedThinkingLevel: agent.thinkingLevel,
      models: [],
      allowManualModel: !profileModels && (runtimeType !== 'cursor' || legacyCursor),
      supportsPermissionOverrides: !legacyCursor,
      permissionNote: legacyCursor
        ? 'This session uses CLI-managed approvals. Host approval overrides do not control native Cursor tools.'
        : 'Host approval rules apply only to requests sent to ZClaudia. Native modes and engine rules may approve tools first. These settings do not create a read-only sandbox.',
    };
    if (profileModels) {
      result.models = (llm?.models ?? []).map(m => ({
        id: m.modelId,
        label: m.displayName || m.modelId,
        thinkingLevels: allowedLevels(runtimeType, m.thinkingLevels),
      }));
      return result;
    }
    let cache = caches.get(this.db);
    if (!cache) {
      cache = new Map();
      caches.set(this.db, cache);
    }
    const key = JSON.stringify([
      sessionId,
      runtimeType,
      engineMode,
      transport,
      agent.cliPath,
      row.cwd,
      agent.updatedAt,
    ]);
    let catalog = cache.get(key);
    if (forceRefresh) catalog = undefined;
    if (catalog && catalog.expires < Date.now()) catalog = undefined;
    if (!catalog && discover) {
      const adapter = this.registry.get(runtimeType);
      if (!adapter?.discoverModels) {
        result.discoveryError =
          'This runtime does not provide model discovery. Use its default or enter a model ID.';
      } else {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 15_000);
        try {
          const managed = await managedRuntimeService.resolveForRuntime(runtimeType, {
            explicitPath: agent.cliPath,
            headless: true,
            allowAutoInstall: false,
          });
          if (managed && managed.status !== 'resolved') throw new Error('Runtime unavailable');
          abort.signal.throwIfAborted();
          const discovered = await Promise.race([
            adapter.discoverModels(
              {
                cwd: row.cwd,
                cliPath: managed?.executablePath ?? agent.cliPath,
                claudiaSessionId: sessionId,
                ...(runtimeType === 'cursor' ? { providerTransport: transport } : {}),
              },
              abort.signal
            ),
            new Promise<never>((_, reject) =>
              abort.signal.addEventListener(
                'abort',
                () => reject(new Error('Model discovery timed out')),
                { once: true }
              )
            ),
          ]);
          catalog = { expires: Date.now() + 60_000, catalog: discovered };
          if (cache.size > 100) cache.clear();
          cache.set(key, catalog);
        } catch {
          // Do not expose CLI stderr, credentials, or provider configuration.
          result.discoveryError =
            'Could not load models from this runtime. Check its connection and retry.';
        } finally {
          clearTimeout(timer);
          abort.abort();
        }
      }
    }
    if (catalog) {
      result.models = catalog.catalog.models.slice(0, 1000).map(m => ({
        id: m.id,
        label: m.label,
        thinkingLevels: allowedLevels(runtimeType, m.thinkingLevels),
      }));
      result.defaultModel = catalog.catalog.currentModel;
    }
    return result;
  }

  async save(sessionId: string, input: unknown): Promise<SessionModelSettings> {
    const assertEditable = () => {
      const { row, agent } = this.context(sessionId);
      if (this.isRunning(sessionId))
        throw new ModelSettingsError(
          409,
          'SESSION_BUSY',
          'Stop the current run before changing its model.'
        );
      if (
        row.is_read_only ||
        row.archived_at ||
        row.type === 'agent' ||
        agent.status === 'readonly'
      ) {
        throw new ModelSettingsError(409, 'SESSION_READONLY', 'This session cannot be edited.');
      }
    };
    assertEditable();
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new ModelSettingsError(400, 'INVALID_MODEL_SETTINGS', 'Expected model settings.');
    const body = input as Record<string, unknown>;
    if (Object.keys(body).some(k => !['model', 'thinkingLevel', 'revision'].includes(k)))
      throw new ModelSettingsError(400, 'INVALID_MODEL_SETTINGS', 'Unknown model setting.');
    if (
      body.model !== null &&
      (typeof body.model !== 'string' ||
        !body.model.trim() ||
        body.model.length > 512 ||
        [...body.model].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
    ) {
      throw new ModelSettingsError(
        400,
        'INVALID_MODEL',
        'Model must be a non-empty ID or null to inherit.'
      );
    }
    if (
      body.thinkingLevel !== null &&
      (typeof body.thinkingLevel !== 'string' || !LEVELS.has(body.thinkingLevel))
    ) {
      throw new ModelSettingsError(400, 'INVALID_THINKING_LEVEL', 'Unknown thinking level.');
    }
    const settings = await this.read(
      sessionId,
      body.thinkingLevel !== null || this.context(sessionId).runtimeType === 'cursor'
    );
    const model = typeof body.model === 'string' ? body.model.trim() : null;
    if (
      model !== null &&
      model !== settings.selection.model &&
      !settings.allowManualModel &&
      !settings.models.some(m => m.id === model)
    ) {
      throw new ModelSettingsError(
        400,
        'MODEL_UNAVAILABLE',
        'Select a model offered by this session connection.'
      );
    }
    const effectiveModel = model ?? (settings.inheritedModel || settings.defaultModel);
    const modelInfo = settings.models.find(m => m.id === effectiveModel);
    if (
      body.thinkingLevel !== null &&
      !modelInfo?.thinkingLevels?.includes(body.thinkingLevel as string)
    ) {
      throw new ModelSettingsError(
        400,
        'THINKING_UNSUPPORTED',
        'This model does not advertise that thinking level. Refresh the model list or use Default.'
      );
    }
    // Recheck after discovery: a run or another client may have changed state.
    assertEditable();
    const current = readSessionModelSelection(this.db, sessionId);
    if (body.revision !== current.revision)
      throw new ModelSettingsError(
        409,
        'MODEL_SETTINGS_CHANGED',
        'Settings changed in another window. Reopen the selector and try again.'
      );
    const selection: SessionModelSelection = {
      model,
      thinkingLevel: body.thinkingLevel as ThinkingLevel | null,
      revision: current.revision + 1,
    };
    writeSessionModelSelection(this.db, sessionId, selection);
    return { ...settings, selection };
  }
}
