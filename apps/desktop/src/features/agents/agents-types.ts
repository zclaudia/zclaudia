/** Tabs inside the Agents shell mode. 'all' is the unified library view. */
export type AgentsTab = 'all' | 'profiles' | 'skills' | 'mcp-servers' | 'providers';

// Deliberately named `llm-profile` (not `provider`) to avoid colliding with
// the agent `profile` kind above — these selections address LLM profiles
// (Providers tab), not agent profiles (Profiles tab).
export type AgentsSelection =
  | { backendId: string; kind: 'profile'; id: string }
  | { backendId: string; kind: 'new-profile' }
  | { backendId: string; kind: 'skill'; id: string }
  | { backendId: string; kind: 'new-skill' }
  | { backendId: string; kind: 'skill-dirs' }
  | { backendId: string; kind: 'mcp-server'; id: string }
  | { backendId: string; kind: 'new-mcp-server' }
  | { backendId: string; kind: 'llm-profile'; id: string }
  | { backendId: string; kind: 'new-llm-profile' };

/** The concrete resource kinds that appear as cards in the library. */
export type LibraryItemKind = 'profile' | 'skill' | 'mcp-server' | 'llm-profile';

/** A single card in the Agent library browse grid. */
export interface LibraryItem {
  kind: LibraryItemKind;
  backendId: string;
  id: string;
  title: string;
  subtitle?: string;
  /** e.g. 'Default' (profile), 'connected' (mcp) — rendered as a status badge. */
  status?: string;
}

/** A backend row in the Agents shell mode (tree + editor header). */
export interface AgentsBackend {
  backendId: string;
  name: string;
  online: boolean;
}
