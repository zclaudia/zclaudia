/** Tabs inside the Agents shell mode. Phase 3 adds 'mcp-servers'. */
export type AgentsTab = 'profiles' | 'skills';

export type AgentsSelection =
  | { backendId: string; kind: 'profile'; id: string }
  | { backendId: string; kind: 'new-profile' }
  | { backendId: string; kind: 'skill'; id: string }
  | { backendId: string; kind: 'new-skill' }
  | { backendId: string; kind: 'skill-dirs' };

/** A backend row in the Agents shell mode (tree + editor header). */
export interface AgentsBackend {
  backendId: string;
  name: string;
  online: boolean;
}
