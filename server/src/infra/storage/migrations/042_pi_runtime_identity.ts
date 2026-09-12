import type { Migration } from './types.js';

/** Rename only runtime identities. Product names, LLM providers and session IDs stay intact. */
export const migration: Migration = {
  name: '042_pi_runtime_identity',
  sql: `
-- Replace the column to change its SQL default without dropping agent_profiles
-- (sessions/projects reference that table). All other columns and indexes survive.
ALTER TABLE agent_profiles ADD COLUMN runtime_type_pi TEXT NOT NULL DEFAULT 'pi';
UPDATE agent_profiles SET runtime_type_pi =
  CASE WHEN runtime_type = 'zclaudia' THEN 'pi' ELSE runtime_type END;
ALTER TABLE agent_profiles DROP COLUMN runtime_type;
ALTER TABLE agent_profiles RENAME COLUMN runtime_type_pi TO runtime_type;

UPDATE session_runtime_bindings SET runtime_type = 'pi' WHERE runtime_type = 'zclaudia';

-- Only valid scope arrays containing the exact legacy identity are changed.
-- Arbitrary JSON strings, user text, NULL and unrestricted scopes stay untouched.
UPDATE mcp_servers SET provider_scope = (
  SELECT json_group_array(CASE WHEN value = 'zclaudia' THEN 'pi' ELSE value END)
  FROM json_each(mcp_servers.provider_scope)
)
WHERE EXISTS (
  SELECT 1 FROM json_each(
    CASE WHEN json_valid(provider_scope) THEN
      CASE WHEN json_type(provider_scope) = 'array' THEN provider_scope ELSE '[]' END
    ELSE '[]' END
  ) WHERE value = 'zclaudia'
);
`,
};
