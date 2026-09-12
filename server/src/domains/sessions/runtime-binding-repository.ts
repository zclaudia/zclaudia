import type Database from 'better-sqlite3';

/**
 * Per-session runtime binding (design:
 * docs/plans/2026-09-11-claude-dual-mode-runtime-design.md §7,
 * docs/plans/2026-09-11-codex-dual-mode-runtime-design.md §7.2).
 *
 * The binding is the immutable run identity a session was started with: engine
 * mode, model, the bound LLM profile (canonical FK column — never duplicated
 * into the JSON), the connection identity hash, and the session-scoped config
 * namespace. Sensitive values (API keys, headers) are never persisted here.
 *
 * Once a binding exists, later runs resolve through it instead of the agent's
 * current configuration, so editing an agent never rewrites history — and a
 * changed connection identity stops the run before any conversation history
 * reaches a new endpoint.
 */

/** Versioned, non-sensitive per-runtime extension details. */
export interface SessionRuntimeDetails {
  schemaVersion: 1;
  /** Codex SDK: the dedicated TOML provider id used for the connection. */
  providerId?: string;
  /** Normalized working directory the provider session was started in. */
  cwd?: string;
}

export interface SessionRuntimeBinding {
  sessionId: string;
  runtimeType: string;
  engineMode: string;
  model: string | null;
  llmProfileId: string | null;
  connectionIdentityHash: string | null;
  configuredCliPath: string | null;
  /** Relative logical identifier; the absolute path derives from the backend data dir. */
  configNamespace: string | null;
  runtimeDetails: SessionRuntimeDetails | null;
  createdAt: number;
  updatedAt: number;
}

export type SessionRuntimeBindingWrite = Omit<SessionRuntimeBinding, 'createdAt' | 'updatedAt'>;

interface BindingRow {
  session_id: string;
  llm_profile_id: string | null;
  runtime_type: string;
  engine_mode: string;
  model: string | null;
  connection_identity_hash: string | null;
  configured_cli_path: string | null;
  config_namespace: string | null;
  runtime_details: string | null;
  created_at: number;
  updated_at: number;
}

function parseRuntimeDetails(raw: string | null): SessionRuntimeDetails | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionRuntimeDetails;
    if (parsed && parsed.schemaVersion === 1) return parsed;
    return null;
  } catch {
    return null;
  }
}

function mapRow(row: BindingRow): SessionRuntimeBinding {
  return {
    sessionId: row.session_id,
    llmProfileId: row.llm_profile_id,
    runtimeType: row.runtime_type,
    engineMode: row.engine_mode,
    model: row.model,
    connectionIdentityHash: row.connection_identity_hash,
    configuredCliPath: row.configured_cli_path,
    configNamespace: row.config_namespace,
    runtimeDetails: parseRuntimeDetails(row.runtime_details),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SessionRuntimeBindingRepository {
  constructor(private readonly db: Database.Database) {}

  findBySessionId(sessionId: string): SessionRuntimeBinding | null {
    const row = this.db
      .prepare('SELECT * FROM session_runtime_bindings WHERE session_id = ?')
      .get(sessionId) as BindingRow | undefined;
    return row ? mapRow(row) : null;
  }

  /**
   * Insert or replace the binding for a session. The first binding wins for
   * identity fields that must never be silently rewritten: callers that need to
   * change a binding go through explicit session-rebind flows, not this method.
   */
  upsert(binding: SessionRuntimeBindingWrite): SessionRuntimeBinding {
    const now = Date.now();
    this.db
      .prepare(
        `
        INSERT INTO session_runtime_bindings (
          session_id, llm_profile_id, runtime_type, engine_mode, model,
          connection_identity_hash, configured_cli_path, config_namespace,
          runtime_details, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO NOTHING
        `
      )
      .run(
        binding.sessionId,
        binding.llmProfileId,
        binding.runtimeType,
        binding.engineMode,
        binding.model,
        binding.connectionIdentityHash,
        binding.configuredCliPath,
        binding.configNamespace,
        binding.runtimeDetails ? JSON.stringify(binding.runtimeDetails) : null,
        now,
        now
      );
    const stored = this.findBySessionId(binding.sessionId);
    if (!stored)
      throw new Error(`session_runtime_bindings row missing after upsert: ${binding.sessionId}`);
    return stored;
  }

  /** Bindings that reference a connection identity hash (drives key creation rules). */
  countWithConnectionIdentity(): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM session_runtime_bindings WHERE connection_identity_hash IS NOT NULL'
      )
      .get() as { n: number };
    return row.n;
  }

  countByLlmProfileId(llmProfileId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM session_runtime_bindings WHERE llm_profile_id = ?')
      .get(llmProfileId) as { n: number };
    return row.n;
  }

  /** Sessions bound to a profile — used by deletion flows to report blockers. */
  sessionIdsByLlmProfileId(llmProfileId: string, limit = 20): string[] {
    const rows = this.db
      .prepare('SELECT session_id FROM session_runtime_bindings WHERE llm_profile_id = ? LIMIT ?')
      .all(llmProfileId, limit) as Array<{ session_id: string }>;
    return rows.map(row => row.session_id);
  }
}
