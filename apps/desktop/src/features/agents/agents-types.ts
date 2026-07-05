/** Tabs inside the Agents shell mode. Phase 2 adds 'skills', Phase 3 'mcp-servers'. */
export type AgentsTab = 'profiles';

export type AgentsSelection =
  | { backendId: string; kind: 'profile'; id: string }
  | { backendId: string; kind: 'new' };

/** A backend row in the Agents shell mode (tree + editor header). */
export interface AgentsBackend {
  backendId: string;
  name: string;
  online: boolean;
}
