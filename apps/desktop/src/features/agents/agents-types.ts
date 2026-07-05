/** Tabs inside the Agents shell mode. Phase 2 adds 'skills', Phase 3 'mcp-servers'. */
export type AgentsTab = 'profiles';

export type AgentsSelection =
  | { backendId: string; kind: 'profile'; id: string }
  | { backendId: string; kind: 'new' };
