import type { AgentsTab } from './agents-types';

/**
 * Creatable selection kinds handled by the inline editor path. Profiles are
 * created via the pre-flight NewAgentProfileModal, so 'new-profile' is not here.
 */
export type NewSelectionKind = 'new-skill' | 'new-mcp-server' | 'new-llm-profile';

export type NewTarget = NewSelectionKind;

export function resolveNewTarget(tab: Exclude<AgentsTab, 'profiles'>): NewTarget {
  switch (tab) {
    case 'skills':
      return 'new-skill';
    case 'mcp-servers':
      return 'new-mcp-server';
    case 'providers':
      return 'new-llm-profile';
  }
}
