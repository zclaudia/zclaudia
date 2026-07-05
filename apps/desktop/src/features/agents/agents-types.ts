/** Tabs inside the Agents shell mode. */
export type AgentsTab = 'profiles' | 'skills' | 'mcp-servers';

export type AgentsSelection =
  | { backendId: string; kind: 'profile'; id: string }
  | { backendId: string; kind: 'new-profile' }
  | { backendId: string; kind: 'skill'; id: string }
  | { backendId: string; kind: 'new-skill' }
  | { backendId: string; kind: 'skill-dirs' }
  | { backendId: string; kind: 'mcp-server'; id: string }
  | { backendId: string; kind: 'new-mcp-server' };

/** A backend row in the Agents shell mode (tree + editor header). */
export interface AgentsBackend {
  backendId: string;
  name: string;
  online: boolean;
}
