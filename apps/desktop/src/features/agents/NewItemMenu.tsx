import type { AgentsTab } from './agents-types';

/**
 * The creatable selection kinds. Deliberately narrower than
 * `AgentsSelection['kind']` (excludes item and `skill-dirs` kinds) so callers
 * that build a `new-*` selection from a `NewTarget` are provably constructing a
 * fieldless `{ backendId, kind }` selection — no accidental id-bearing kind.
 */
export type NewSelectionKind = 'new-profile' | 'new-skill' | 'new-mcp-server' | 'new-llm-profile';

export type NewTarget = NewSelectionKind;

export function resolveNewTarget(tab: AgentsTab): NewTarget {
  switch (tab) {
    case 'profiles':
      return 'new-profile';
    case 'skills':
      return 'new-skill';
    case 'mcp-servers':
      return 'new-mcp-server';
    case 'providers':
      return 'new-llm-profile';
  }
}
