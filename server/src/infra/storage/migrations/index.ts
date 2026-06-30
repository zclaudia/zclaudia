import type { Migration } from './types.js';

import { migration as m_001_initial_schema } from './001_initial_schema.js';
import { migration as m_002_request_headers } from './002_request_headers.js';
import { migration as m_003_llm_profile_models } from './003_llm_profile_models.js';
import { migration as m_004_merge_openai_custom } from './004_merge_openai_custom.js';
import { migration as m_005_llm_profile_oauth } from './005_llm_profile_oauth.js';
import { migration as m_006_tasks } from './006_tasks.js';
import { migration as m_007_drop_legacy_orchestrator_tasks } from './007_drop_legacy_orchestrator_tasks.js';
import { migration as m_008_agent_profile_tool_selection } from './008_agent_profile_tool_selection.js';
import { migration as m_009_agent_profile_skill_selection } from './009_agent_profile_skill_selection.js';
import { migration as m_010_agent_profile_skill_execution } from './010_agent_profile_skill_execution.js';
import { migration as m_011_mcp_server_trust_policy } from './011_mcp_server_trust_policy.js';
import { migration as m_012_mcp_remote_oauth } from './012_mcp_remote_oauth.js';
import { migration as m_013_agent_profile_plugin_ownership } from './013_agent_profile_plugin_ownership.js';
import { migration as m_014_mcp_headers_helper } from './014_mcp_headers_helper.js';
import { migration as m_015_llm_profile_cache_retention } from './015_llm_profile_cache_retention.js';
import { migration as m_016_user_hooks } from './016_user_hooks.js';
import { migration as m_017_compaction_overflow_source } from './017_compaction_overflow_source.js';
import { migration as m_018_eval_task_type } from './018_eval_task_type.js';
import { migration as m_019_session_auto_title } from './019_session_auto_title.js';
import { migration as m_020_backfill_message_offset } from './020_backfill_message_offset.js';
import { migration as m_021_session_entries } from './021_session_entries.js';
import { migration as m_022_drop_session_compactions } from './022_drop_session_compactions.js';
import { migration as m_023_web_search_config } from './023_web_search_config.js';
import { migration as m_024_session_fork_lineage } from './024_session_fork_lineage.js';
import { migration as m_025_message_tree_entry_id } from './025_message_tree_entry_id.js';
import { migration as m_026_session_goals } from './026_session_goals.js';
import { migration as m_027_agent_multimodal_fallback } from './027_agent_multimodal_fallback.js';
import { migration as m_028_agent_loop_contexts } from './028_agent_loop_contexts.js';
import { migration as m_029_automations } from './029_automations.js';
import { migration as m_030_generalize_workflow_runs } from './030_generalize_workflow_runs.js';

export type { Migration };

export const migrations: Migration[] = [
  m_001_initial_schema,
  m_002_request_headers,
  m_003_llm_profile_models,
  m_004_merge_openai_custom,
  m_005_llm_profile_oauth,
  m_006_tasks,
  m_007_drop_legacy_orchestrator_tasks,
  m_008_agent_profile_tool_selection,
  m_009_agent_profile_skill_selection,
  m_010_agent_profile_skill_execution,
  m_011_mcp_server_trust_policy,
  m_012_mcp_remote_oauth,
  m_013_agent_profile_plugin_ownership,
  m_014_mcp_headers_helper,
  m_015_llm_profile_cache_retention,
  m_016_user_hooks,
  m_017_compaction_overflow_source,
  m_018_eval_task_type,
  m_019_session_auto_title,
  m_020_backfill_message_offset,
  m_021_session_entries,
  m_022_drop_session_compactions,
  m_023_web_search_config,
  m_024_session_fork_lineage,
  m_025_message_tree_entry_id,
  m_026_session_goals,
  m_027_agent_multimodal_fallback,
  m_028_agent_loop_contexts,
  m_029_automations,
  m_030_generalize_workflow_runs,
];

/**
 * Apply all migrations to a database. Idempotent — uses the same `migrations`
 * tracking table as production `runMigrations` in db.ts. Intended for tests
 * that need a fully-migrated in-memory DB without going through `initDatabase`.
 */
export function applyMigrations(db: import('better-sqlite3').Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT name FROM migrations').all() as Array<{ name: string }>).map((r) => r.name),
  );

  const insert = db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)');

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    try {
      db.exec(migration.sql);
    } catch (error) {
      if (migration.idempotent) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('duplicate column name:')) {
          // Schema already applied; record and continue.
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    insert.run(migration.name, Date.now());
  }
}
