import type { Migration } from './types.js';

export const migration: Migration = {
  name: '001_initial_schema',
  sql: `
CREATE TABLE IF NOT EXISTS agent_activity_log (
          id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          summary TEXT NOT NULL,
          metadata TEXT,
          created_at INTEGER NOT NULL
        );

CREATE TABLE IF NOT EXISTS agent_config (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          enabled INTEGER NOT NULL DEFAULT 1,
          project_id TEXT,
          session_id TEXT,
          permission_policy TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        , llm_profile_id TEXT, permission_workflow_override_id TEXT REFERENCES workflows(id) ON DELETE SET NULL);

CREATE TABLE IF NOT EXISTS agent_memory (
          id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          namespace TEXT NOT NULL DEFAULT 'default',
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          source_task_id TEXT,
          source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          author_scope TEXT NOT NULL DEFAULT 'project',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(project_id, namespace, key)
        );

CREATE TABLE IF NOT EXISTS agent_triggers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          trigger_type TEXT NOT NULL CHECK(trigger_type IN ('event', 'schedule', 'both')),
          event_pattern TEXT,
          event_filter TEXT,
          prompt_template TEXT NOT NULL,
          llm_profile_id TEXT,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          context_template TEXT DEFAULT 'agent',
          feed_delivery INTEGER NOT NULL DEFAULT 1,
          notify_delivery INTEGER NOT NULL DEFAULT 0,
          source_plugin_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        , schedule_type TEXT, schedule_cron TEXT, schedule_interval_minutes INTEGER);

CREATE TABLE IF NOT EXISTS app_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

CREATE TABLE IF NOT EXISTS attachments (
          id TEXT PRIMARY KEY,
          owner_kind TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          storage_key TEXT NOT NULL,
          name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size INTEGER NOT NULL,
          kind TEXT NOT NULL DEFAULT 'file'
            CHECK (kind IN ('image','video','audio','document','file')),
          sha256 TEXT,
          width INTEGER,
          height INTEGER,
          created_by TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );

CREATE TABLE IF NOT EXISTS bootstrap_candidates (
      id              TEXT PRIMARY KEY,
      scan_id         TEXT NOT NULL REFERENCES bootstrap_scans(id) ON DELETE CASCADE,
      capability      TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL,
      source          TEXT NOT NULL,
      selected        INTEGER NOT NULL DEFAULT 1,
      phase           TEXT NOT NULL,
      generated_md    TEXT,
      generation_attempts INTEGER NOT NULL DEFAULT 0,
      error_message   TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      UNIQUE (scan_id, capability)
    );

CREATE TABLE IF NOT EXISTS bootstrap_review_items (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL,
      capability TEXT NOT NULL,
      operation TEXT NOT NULL
        CHECK (operation IN ('modify','remove')),
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected')),
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      FOREIGN KEY (scan_id) REFERENCES bootstrap_scans(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS bootstrap_scans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','awaiting_review','completed','failed','cancelled')),
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      applied_count INTEGER NOT NULL DEFAULT 0,
      pending_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT, init_phase TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS change_gate_reviews (
          id TEXT PRIMARY KEY,
          change_id TEXT NOT NULL,
          gate_type TEXT NOT NULL,
          status TEXT NOT NULL,
          decision TEXT,
          notes TEXT,
          reviewer_user_id TEXT,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER,
          FOREIGN KEY (change_id) REFERENCES project_changes(id) ON DELETE CASCADE
        );

CREATE TABLE IF NOT EXISTS change_sync_runs (
          id TEXT PRIMARY KEY,
          change_id TEXT NOT NULL,
          status TEXT NOT NULL,
          summary TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          applied_at INTEGER,
          FOREIGN KEY (change_id) REFERENCES project_changes(id) ON DELETE CASCADE
        );

CREATE TABLE IF NOT EXISTS claudia_branches (
          id TEXT PRIMARY KEY,
          host_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          active_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          title TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_task_id TEXT
        );

CREATE TABLE IF NOT EXISTS claudia_project_state (
          host_project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          active_branch_id TEXT REFERENCES claudia_branches(id) ON DELETE SET NULL,
          updated_at INTEGER NOT NULL
        );

CREATE TABLE IF NOT EXISTS delegation_config (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          config TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

CREATE TABLE IF NOT EXISTS epics (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','closed','cancelled')),
      labels TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS executor_instances (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      spec_change_id TEXT NOT NULL,
      type TEXT NOT NULL
        CHECK (type IN ('classic','meta-workflow','manual','superpowers')),
      underlying_id TEXT,
      status_summary TEXT NOT NULL DEFAULT 'pending'
        CHECK (status_summary IN ('pending','executing','paused','completed','failed','cancelled')),
      progress_json TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_change_id) REFERENCES spec_changes(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS file_references (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_rowid INTEGER NOT NULL,
          message_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          file_path TEXT NOT NULL,
          source_type TEXT NOT NULL, -- 'tool_call' or 'attachment'
          created_at INTEGER NOT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        );

CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );

CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
          file_path,
          source_type UNINDEXED,
          session_id UNINDEXED,
          message_id UNINDEXED,
          content=file_references,
          content_rowid=id
        );

CREATE TABLE IF NOT EXISTS gateway_config (
          id INTEGER PRIMARY KEY CHECK(id = 1), -- 单例配置
          enabled INTEGER NOT NULL DEFAULT 0,
          gateway_url TEXT,
          gateway_secret TEXT,
          backend_name TEXT,
          backend_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        , proxy_url TEXT, proxy_username TEXT, proxy_password TEXT, register_as_backend INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS local_issue_comments (
      id         TEXT PRIMARY KEY,
      issue_id   TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (issue_id) REFERENCES local_issues(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS "local_issues" (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','tracked','closed','cancelled')),
      priority TEXT NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low','medium','high','critical')),
      labels TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER,
      type TEXT NOT NULL DEFAULT 'implement'
        CHECK (type IN ('implement','bug','enhancement','chore')),
      epic_id TEXT REFERENCES epics(id) ON DELETE SET NULL,
      spec_change_id TEXT,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS local_prs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          worktree_path TEXT NOT NULL,
          branch_name TEXT NOT NULL,
          base_branch TEXT NOT NULL DEFAULT 'master',
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'open'
            CHECK (status IN ('open','reviewing','review_failed','approved','merging','merged','conflict','closed')),
          commits TEXT,
          diff_summary TEXT,
          review_session_id TEXT,
          conflict_session_id TEXT,
          review_notes TEXT,
          status_message TEXT,
          auto_triggered INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          merged_at INTEGER,
          merged_commit_sha TEXT, auto_review INTEGER NOT NULL DEFAULT 0, execution_state TEXT NOT NULL DEFAULT 'idle'
          CHECK (execution_state IN ('idle', 'queued', 'running', 'failed')), pending_action TEXT NOT NULL DEFAULT 'none'
          CHECK (pending_action IN ('none', 'review', 'merge', 'resolve_conflict')), execution_error TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

CREATE TABLE IF NOT EXISTS managed_processes (
          process_id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          status TEXT NOT NULL,
          pid INTEGER,
          ppid INTEGER,
          root_pid INTEGER,
          pgid INTEGER,
          command TEXT NOT NULL,
          args_json TEXT NOT NULL,
          cwd TEXT,
          owner_session_id TEXT,
          owner_task_id TEXT,
          owner_backend_id TEXT,
          owner_run_id TEXT,
          owner_request_id TEXT,
          parent_process_id TEXT,
          started_at INTEGER NOT NULL,
          exited_at INTEGER,
          exit_code INTEGER,
          signal TEXT,
          protected INTEGER NOT NULL DEFAULT 0,
          tags_json TEXT NOT NULL,
          adopted INTEGER NOT NULL DEFAULT 0,
          orphaned_at INTEGER,
          metadata_json TEXT
        );

CREATE TABLE IF NOT EXISTS mcp_servers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          command TEXT NOT NULL,
          args TEXT,
          env TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          description TEXT,
          source TEXT NOT NULL DEFAULT 'user',
          provider_scope TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT CHECK(role IN ('user', 'assistant', 'system')) NOT NULL,
          content TEXT NOT NULL,
          metadata TEXT,
          created_at INTEGER NOT NULL, offset INTEGER,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content,
          session_id UNINDEXED,
          role UNINDEXED
        );

CREATE TABLE IF NOT EXISTS meta_subagent_templates (
      id TEXT PRIMARY KEY,
      name TEXT,
      system_prompt TEXT NOT NULL,
      allowed_tools TEXT NOT NULL,
      max_turns INTEGER NOT NULL DEFAULT 30,
      termination_condition TEXT NOT NULL,
      source_type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

CREATE TABLE IF NOT EXISTS meta_workflow_artifacts (
      id TEXT PRIMARY KEY,
      phase_record_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      commit_sha TEXT,
      artifact_files TEXT,
      gate_results TEXT,
      ai_review_notes_path TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (phase_record_id) REFERENCES meta_workflow_phases(id) ON DELETE CASCADE,
      UNIQUE (phase_record_id, version)
    );

CREATE TABLE IF NOT EXISTS meta_workflow_phases (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      phase_id TEXT NOT NULL,
      phase_type TEXT NOT NULL,
      status TEXT NOT NULL,
      execute_entity TEXT NOT NULL,
      reused_from_pool_id TEXT,
      generated_workflow_id TEXT,
      generated_subagent_id TEXT,
      current_run_id TEXT,
      worktree_path TEXT,
      stale_since INTEGER,
      stale_source_phase_id TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      inputs_snapshot TEXT,
      outputs_snapshot TEXT,
      gates_snapshot TEXT,
      execute_config_snapshot TEXT,
      synthesizer_llm_profile_id TEXT,
      runtime_llm_profile_id TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (run_id) REFERENCES meta_workflow_runs(id) ON DELETE CASCADE,
      UNIQUE (run_id, phase_id)
    );

CREATE TABLE IF NOT EXISTS meta_workflow_reuse_pool (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      phase_type TEXT NOT NULL,
      description TEXT,
      tags TEXT,
      source_type TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      archived_at INTEGER
    );

CREATE TABLE IF NOT EXISTS meta_workflow_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      requirements_path TEXT,
      phases_json TEXT,
      smoke_path_run_id TEXT,
      reject_count INTEGER NOT NULL DEFAULT 0,
      default_llm_profile_id TEXT,
      config TEXT,
      worktree_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS notification_config (
          id TEXT PRIMARY KEY DEFAULT 'default',
          config TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

CREATE TABLE IF NOT EXISTS "notifications" (
          id TEXT PRIMARY KEY,
          trigger_id TEXT,
          task_id TEXT,
          session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          source TEXT NOT NULL CHECK(source IN ('trigger', 'scheduled', 'manual', 'delegation')),
          title TEXT NOT NULL,
          summary TEXT,
          status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed')),
          error TEXT,
          delegation_context TEXT,
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          read_at INTEGER
        , initiator TEXT);

CREATE TABLE IF NOT EXISTS permission_logs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          tool TEXT NOT NULL,
          detail TEXT NOT NULL,
          decision TEXT CHECK(decision IN ('allow', 'deny', 'timeout')) NOT NULL,
          remembered INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

CREATE TABLE IF NOT EXISTS permission_memories (
          session_id TEXT NOT NULL,
          remember_key TEXT NOT NULL,
          decision TEXT CHECK(decision IN ('allow', 'deny')) NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, remember_key),
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

CREATE TABLE IF NOT EXISTS permission_outside_workspace_roots (
          project_id TEXT NOT NULL,
          allowed_root TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (project_id, allowed_root),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

CREATE TABLE IF NOT EXISTS project_changes (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          slug TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          motivation TEXT,
          non_goals TEXT,
          scope TEXT,
          acceptance_criteria TEXT,
          status TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 0,
          baseline_version TEXT,
          design_approved_at INTEGER,
          execution_approved_at INTEGER,
          sync_approved_at INTEGER,
          worktree_id TEXT,
          local_pr_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          completed_at INTEGER,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

CREATE TABLE IF NOT EXISTS project_spec_corpus_meta (
      project_id TEXT PRIMARY KEY,
      initialized INTEGER NOT NULL DEFAULT 0,
      last_bootstrap_at INTEGER,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT CHECK(type IN ('chat_only', 'code')) DEFAULT 'code',
          default_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
          root_path TEXT,
          system_prompt TEXT,
          permission_policy TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL, agent_permission_override TEXT, is_internal INTEGER NOT NULL DEFAULT 0, agent TEXT, context_sync_status TEXT NOT NULL DEFAULT 'synced', review_llm_profile_id TEXT REFERENCES llm_profiles(id) ON DELETE SET NULL, sort_order INTEGER NOT NULL DEFAULT 0, permission_workflow_override_id TEXT REFERENCES workflows(id) ON DELETE SET NULL
        );

CREATE TABLE IF NOT EXISTS llm_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          provider_type TEXT NOT NULL DEFAULT 'anthropic',
          base_url TEXT,
          api_key TEXT,
          compat TEXT,
          env TEXT,
          is_default INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

CREATE TABLE IF NOT EXISTS agent_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          llm_profile_id TEXT NOT NULL REFERENCES llm_profiles(id) ON DELETE RESTRICT,
          model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
          system_prompt TEXT NOT NULL DEFAULT '',
          enabled_tools TEXT NOT NULL DEFAULT '["Read","Write","Edit","Bash","Grep","Find","Glob","LS"]',
          tool_selection TEXT,
          thinking_level TEXT,
          is_default INTEGER DEFAULT 0,
          context_window INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

CREATE TABLE IF NOT EXISTS scheduled_tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          name TEXT NOT NULL,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          schedule_type TEXT NOT NULL CHECK (schedule_type IN ('cron', 'interval', 'once')),
          schedule_cron TEXT,
          schedule_interval_minutes INTEGER,
          schedule_once_at INTEGER,
          next_run INTEGER,
          action_type TEXT NOT NULL CHECK (action_type IN ('prompt', 'command', 'shell', 'webhook', 'plugin_event')),
          action_config TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'error')),
          last_run_at INTEGER,
          last_run_result TEXT,
          last_error TEXT,
          run_count INTEGER NOT NULL DEFAULT 0,
          template_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

CREATE TABLE IF NOT EXISTS search_history (
          id TEXT PRIMARY KEY,
          user_id TEXT DEFAULT 'default',
          query TEXT NOT NULL,
          result_count INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL
        );

CREATE TABLE IF NOT EXISTS servers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          address TEXT NOT NULL,
          connection_mode TEXT CHECK(connection_mode IN ('direct', 'gateway')) DEFAULT 'direct',

          -- Gateway mode fields
          gateway_url TEXT,
          gateway_secret TEXT,
          backend_id TEXT,

          -- Common fields
          api_key TEXT,
          client_id TEXT,
          is_default INTEGER DEFAULT 0,
          requires_auth INTEGER DEFAULT 0,

          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_connected INTEGER
        , proxy_url TEXT, proxy_username TEXT, proxy_password TEXT);

CREATE TABLE IF NOT EXISTS session_drafts (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL UNIQUE,
          content TEXT NOT NULL DEFAULT '',
          editing_by TEXT,
          editing_at INTEGER,
          updated_at INTEGER NOT NULL,
          archived_at INTEGER,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT,
          agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE RESTRICT,
          sdk_session_id TEXT,
          type TEXT CHECK(type IN ('regular', 'background', 'agent')) DEFAULT 'regular',
          parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          working_directory TEXT,
          project_role TEXT,
          task_id TEXT,
          plan_status TEXT,
          is_read_only INTEGER DEFAULT 0,
          last_run_status TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          archived_at INTEGER
        , sort_order INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS session_compactions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  first_kept_message_id TEXT NOT NULL,
  tokens_before INTEGER NOT NULL,
  details TEXT,
  source TEXT NOT NULL CHECK(source IN ('auto', 'manual')) DEFAULT 'auto',
  custom_instructions TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (first_kept_message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS spec_changes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sub_issue_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'drafting'
        CHECK (status IN ('drafting','proposing','designing','tasks_ready','archived','cancelled')),
      proposal_path TEXT NOT NULL,
      design_path TEXT NOT NULL,
      tasks_path TEXT NOT NULL,
      delta_spec_paths TEXT NOT NULL DEFAULT '[]',
      delta_pending_merge INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (sub_issue_id) REFERENCES local_issues(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS "supervision_logs" (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          task_id TEXT,
          event TEXT NOT NULL,
          detail TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

CREATE TABLE IF NOT EXISTS supervision_tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'agent_discovered')),
          session_id TEXT,
          status TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          dependencies TEXT,
          dependency_mode TEXT DEFAULT 'all',
          relevant_doc_ids TEXT,
          task_specific_context TEXT,
          scope TEXT,
          acceptance_criteria TEXT,
          max_retries INTEGER DEFAULT 2,
          attempt INTEGER NOT NULL DEFAULT 1,
          base_commit TEXT,
          result TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER, schedule_cron TEXT, schedule_next_run INTEGER, schedule_enabled INTEGER DEFAULT 0, retry_delay_ms INTEGER DEFAULT 5000, change_id TEXT, change_task_ref TEXT, phase_id TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
        );

CREATE TABLE IF NOT EXISTS task_runs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          task_source TEXT NOT NULL CHECK (task_source IN ('user', 'system')),
          status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          duration_ms INTEGER,
          result TEXT,
          error TEXT,
          created_at INTEGER NOT NULL
        );

CREATE TABLE IF NOT EXISTS tool_call_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_rowid INTEGER NOT NULL,
          message_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          tool_input TEXT,
          tool_result TEXT,
          is_error INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        );

CREATE VIRTUAL TABLE IF NOT EXISTS tool_calls_fts USING fts5(
          tool_name,
          tool_input,
          tool_result,
          session_id UNINDEXED,
          message_id UNINDEXED,
          content=tool_call_records,
          content_rowid=id
        );

CREATE TABLE IF NOT EXISTS turn_summaries (
      session_id       TEXT NOT NULL,
      user_message_id  TEXT NOT NULL,
      as_of_message_id TEXT NOT NULL,
      goal             TEXT NOT NULL,
      solved           TEXT NOT NULL,
      open_issues      TEXT NOT NULL,
      model            TEXT NOT NULL,
      generated_at     INTEGER NOT NULL,
      PRIMARY KEY (session_id, user_message_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS workflow_runs (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          project_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
          trigger_source TEXT NOT NULL DEFAULT 'manual'
            CHECK (trigger_source IN ('manual', 'schedule', 'event')),
          trigger_detail TEXT,
          current_step_id TEXT,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          error TEXT,
          FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
        );

CREATE TABLE IF NOT EXISTS workflow_schedules (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL UNIQUE,
          trigger_index INTEGER NOT NULL DEFAULT 0,
          next_run INTEGER,
          enabled INTEGER NOT NULL DEFAULT 1,
          FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
        );

CREATE TABLE IF NOT EXISTS workflow_step_runs (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          step_id TEXT NOT NULL,
          step_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'waiting')),
          input TEXT,
          output TEXT,
          error TEXT,
          attempt INTEGER NOT NULL DEFAULT 1,
          session_id TEXT,
          started_at INTEGER,
          completed_at INTEGER,
          FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
        );

CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'disabled', 'archived')),
          definition TEXT NOT NULL DEFAULT '{}',
          template_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        , source_plugin_id TEXT, source_type TEXT DEFAULT 'user', authoring_mode TEXT DEFAULT 'graph', is_system INTEGER NOT NULL DEFAULT 0, system_key TEXT);

CREATE TABLE IF NOT EXISTS worktree_configs (
          project_id TEXT NOT NULL,
          worktree_path TEXT NOT NULL,
          auto_create_pr INTEGER NOT NULL DEFAULT 0,
          auto_review INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (project_id, worktree_path),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

CREATE INDEX IF NOT EXISTS idx_agent_activity_log_created ON agent_activity_log(created_at);

CREATE INDEX IF NOT EXISTS idx_agent_activity_log_project ON agent_activity_log(project_id);

CREATE INDEX IF NOT EXISTS idx_agent_memory_namespace ON agent_memory(namespace);

CREATE INDEX IF NOT EXISTS idx_agent_memory_project ON agent_memory(project_id);

CREATE INDEX IF NOT EXISTS idx_agent_triggers_enabled ON agent_triggers(enabled);

CREATE INDEX IF NOT EXISTS idx_attachments_created
          ON attachments(created_at);

CREATE INDEX IF NOT EXISTS idx_attachments_owner
          ON attachments(owner_kind, owner_id);

CREATE INDEX IF NOT EXISTS idx_bootstrap_review_items_scan ON bootstrap_review_items(scan_id, status);

CREATE INDEX IF NOT EXISTS idx_bootstrap_scans_project ON bootstrap_scans(project_id, status);

CREATE INDEX IF NOT EXISTS idx_candidates_scan ON bootstrap_candidates(scan_id);

CREATE INDEX IF NOT EXISTS idx_candidates_scan_phase ON bootstrap_candidates(scan_id, phase);

CREATE INDEX IF NOT EXISTS idx_change_gate_reviews_change
          ON change_gate_reviews(change_id, gate_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_change_sync_runs_change
          ON change_sync_runs(change_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_claudia_branches_project ON claudia_branches(host_project_id);

CREATE INDEX IF NOT EXISTS idx_epics_project ON epics(project_id);

CREATE INDEX IF NOT EXISTS idx_epics_status ON epics(status);

CREATE INDEX IF NOT EXISTS idx_executor_instances_spec_change ON executor_instances(spec_change_id);

CREATE INDEX IF NOT EXISTS idx_executor_instances_status ON executor_instances(project_id, status_summary);

CREATE INDEX IF NOT EXISTS idx_file_references_message ON file_references(message_id);

CREATE INDEX IF NOT EXISTS idx_file_references_session ON file_references(session_id);

CREATE INDEX IF NOT EXISTS idx_llm_profiles_default ON llm_profiles(is_default);

CREATE INDEX IF NOT EXISTS idx_agent_profiles_default ON agent_profiles(is_default);

CREATE INDEX IF NOT EXISTS idx_agent_profiles_llm_profile ON agent_profiles(llm_profile_id);

CREATE INDEX IF NOT EXISTS idx_local_issue_comments_issue
      ON local_issue_comments(issue_id, created_at);

CREATE INDEX IF NOT EXISTS idx_local_issues_epic ON local_issues(epic_id);

CREATE INDEX IF NOT EXISTS idx_local_issues_project ON local_issues(project_id);

CREATE INDEX IF NOT EXISTS idx_local_issues_status ON local_issues(status);

CREATE INDEX IF NOT EXISTS idx_local_issues_type ON local_issues(project_id, type);

CREATE INDEX IF NOT EXISTS idx_local_prs_project ON local_prs(project_id);

CREATE INDEX IF NOT EXISTS idx_local_prs_status ON local_prs(status);

CREATE INDEX IF NOT EXISTS idx_local_prs_worktree ON local_prs(worktree_path);

CREATE INDEX IF NOT EXISTS idx_managed_processes_exited_at ON managed_processes(exited_at);

CREATE INDEX IF NOT EXISTS idx_managed_processes_source ON managed_processes(source);

CREATE INDEX IF NOT EXISTS idx_managed_processes_status ON managed_processes(status);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_name ON mcp_servers(name);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

CREATE INDEX IF NOT EXISTS idx_messages_session_offset
          ON messages(session_id, offset);

CREATE INDEX IF NOT EXISTS idx_meta_artifacts_phase
      ON meta_workflow_artifacts(phase_record_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_meta_artifacts_status
      ON meta_workflow_artifacts(status);

CREATE INDEX IF NOT EXISTS idx_meta_phases_run
      ON meta_workflow_phases(run_id, status);

CREATE INDEX IF NOT EXISTS idx_meta_phases_status
      ON meta_workflow_phases(status);

CREATE INDEX IF NOT EXISTS idx_meta_reuse_entity
      ON meta_workflow_reuse_pool(entity_id);

CREATE INDEX IF NOT EXISTS idx_meta_reuse_kind
      ON meta_workflow_reuse_pool(kind);

CREATE INDEX IF NOT EXISTS idx_meta_reuse_phase_type
      ON meta_workflow_reuse_pool(phase_type, source_type);

CREATE INDEX IF NOT EXISTS idx_meta_runs_project
      ON meta_workflow_runs(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_meta_runs_status
      ON meta_workflow_runs(status);

CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read_at);

CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);

CREATE INDEX IF NOT EXISTS idx_permission_logs_session_id ON permission_logs(session_id);

CREATE INDEX IF NOT EXISTS idx_permission_memories_session_id ON permission_memories(session_id);

CREATE INDEX IF NOT EXISTS idx_permission_outside_workspace_roots_project_id
          ON permission_outside_workspace_roots(project_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_changes_project_slug
          ON project_changes(project_id, slug);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_changes_single_active
          ON project_changes(project_id)
          WHERE active = 1;

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled_next ON scheduled_tasks(enabled, next_run);

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_project ON scheduled_tasks(project_id);

CREATE INDEX IF NOT EXISTS idx_search_history_created_at ON search_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_search_history_user_id ON search_history(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_servers_is_default ON servers(is_default);

CREATE INDEX IF NOT EXISTS idx_session_compactions_session_created
  ON session_compactions(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_drafts_session ON session_drafts(session_id);

CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(archived_at);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);

CREATE INDEX IF NOT EXISTS idx_sessions_agent_profile ON sessions(agent_profile_id);

CREATE INDEX IF NOT EXISTS idx_spec_changes_project ON spec_changes(project_id, status);

CREATE INDEX IF NOT EXISTS idx_spec_changes_sub_issue ON spec_changes(sub_issue_id);

CREATE INDEX IF NOT EXISTS idx_step_runs_run ON workflow_step_runs(run_id);

CREATE INDEX IF NOT EXISTS idx_supervision_logs_project ON supervision_logs(project_id);

CREATE INDEX IF NOT EXISTS idx_supervision_logs_task ON supervision_logs(task_id);

CREATE INDEX IF NOT EXISTS idx_supervision_tasks_change ON supervision_tasks(change_id);

CREATE INDEX IF NOT EXISTS idx_supervision_tasks_project ON supervision_tasks(project_id);

CREATE INDEX IF NOT EXISTS idx_supervision_tasks_schedule
          ON supervision_tasks(schedule_enabled, schedule_next_run);

CREATE INDEX IF NOT EXISTS idx_supervision_tasks_session ON supervision_tasks(session_id);

CREATE INDEX IF NOT EXISTS idx_supervision_tasks_status ON supervision_tasks(status);

CREATE INDEX IF NOT EXISTS idx_task_runs_created ON task_runs(created_at);

CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_call_records_message ON tool_call_records(message_id);

CREATE INDEX IF NOT EXISTS idx_tool_call_records_session ON tool_call_records(session_id);

CREATE INDEX IF NOT EXISTS idx_turn_summaries_session
      ON turn_summaries(session_id);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);

CREATE INDEX IF NOT EXISTS idx_workflow_schedules_next ON workflow_schedules(enabled, next_run);

CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_system_key
          ON workflows(system_key)
          WHERE system_key IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS file_references_fts_delete AFTER DELETE ON file_references BEGIN
          INSERT INTO files_fts(files_fts, rowid, file_path, source_type, session_id, message_id)
            VALUES ('delete', OLD.id, OLD.file_path, OLD.source_type, OLD.session_id, OLD.message_id);
        END;

CREATE TRIGGER IF NOT EXISTS file_references_fts_insert AFTER INSERT ON file_references BEGIN
          INSERT INTO files_fts(rowid, file_path, source_type, session_id, message_id)
            VALUES (NEW.id, NEW.file_path, NEW.source_type, NEW.session_id, NEW.message_id);
        END;

CREATE TRIGGER IF NOT EXISTS file_references_fts_update AFTER UPDATE ON file_references BEGIN
          INSERT INTO files_fts(files_fts, rowid, file_path, source_type, session_id, message_id)
            VALUES ('delete', OLD.id, OLD.file_path, OLD.source_type, OLD.session_id, OLD.message_id);
          INSERT INTO files_fts(rowid, file_path, source_type, session_id, message_id)
            VALUES (NEW.id, NEW.file_path, NEW.source_type, NEW.session_id, NEW.message_id);
        END;

CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
          DELETE FROM messages_fts WHERE rowid = OLD.rowid;
        END;

CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content, session_id, role)
            VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.role);
        END;

CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
          DELETE FROM messages_fts WHERE rowid = OLD.rowid;
          INSERT INTO messages_fts(rowid, content, session_id, role)
            VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.role);
        END;

CREATE TRIGGER IF NOT EXISTS tool_call_records_fts_delete AFTER DELETE ON tool_call_records BEGIN
          INSERT INTO tool_calls_fts(tool_calls_fts, rowid, tool_name, tool_input, tool_result, session_id, message_id)
            VALUES ('delete', OLD.id, OLD.tool_name, OLD.tool_input, OLD.tool_result, OLD.session_id, OLD.message_id);
        END;

CREATE TRIGGER IF NOT EXISTS tool_call_records_fts_insert AFTER INSERT ON tool_call_records BEGIN
          INSERT INTO tool_calls_fts(rowid, tool_name, tool_input, tool_result, session_id, message_id)
            VALUES (NEW.id, NEW.tool_name, NEW.tool_input, NEW.tool_result, NEW.session_id, NEW.message_id);
        END;

CREATE TRIGGER IF NOT EXISTS tool_call_records_fts_update AFTER UPDATE ON tool_call_records BEGIN
          INSERT INTO tool_calls_fts(tool_calls_fts, rowid, tool_name, tool_input, tool_result, session_id, message_id)
            VALUES ('delete', OLD.id, OLD.tool_name, OLD.tool_input, OLD.tool_result, OLD.session_id, OLD.message_id);
          INSERT INTO tool_calls_fts(rowid, tool_name, tool_input, tool_result, session_id, message_id)
            VALUES (NEW.id, NEW.tool_name, NEW.tool_input, NEW.tool_result, NEW.session_id, NEW.message_id);
        END;



-- Seed data

INSERT OR IGNORE INTO gateway_config (id, enabled, created_at, updated_at)
VALUES (1, 0, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO servers (id, name, address, connection_mode, is_default, requires_auth, created_at, updated_at)
VALUES ('local', 'Local Server', 'localhost:3100', 'direct', 1, 0, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO agent_config (id, enabled, created_at, updated_at)
VALUES (1, 1, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO delegation_config (id, config, created_at, updated_at)
VALUES (1, '{"enabled":false,"confidenceThreshold":0.8,"maxAutoApprovalsPerMinute":10,"allowedCategories":["fileRead","fileWrite","shellSafe"],"neverDelegate":["AskUserQuestion","ExitPlanMode"]}', strftime('%s','now')*1000, strftime('%s','now')*1000);
`,
};
