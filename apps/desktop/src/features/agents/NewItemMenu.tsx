import type { AgentsTab } from './agents-types';

/**
 * The creatable selection kinds. Deliberately narrower than
 * `AgentsSelection['kind']` (excludes item and `skill-dirs` kinds) so callers
 * that build a `new-*` selection from a `NewTarget` are provably constructing a
 * fieldless `{ backendId, kind }` selection — no accidental id-bearing kind.
 */
export type NewSelectionKind = 'new-profile' | 'new-skill' | 'new-mcp-server' | 'new-llm-profile';

export type NewTarget = NewSelectionKind | 'menu';

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
    case 'all':
      return 'menu';
  }
}

const MENU_ITEMS: { kind: NewSelectionKind; label: string }[] = [
  { kind: 'new-profile', label: 'New profile' },
  { kind: 'new-skill', label: 'New skill' },
  { kind: 'new-mcp-server', label: 'New MCP server' },
  { kind: 'new-llm-profile', label: 'New provider' },
];

export function NewItemMenu({
  onPick,
  onClose,
}: {
  onPick: (kind: NewSelectionKind) => void;
  onClose: () => void;
}) {
  return (
    <div
      role="menu"
      className="absolute right-0 top-full z-10 mt-1 w-44 rounded-lg border border-border bg-popover p-1 shadow-md"
      onMouseLeave={onClose}
    >
      {MENU_ITEMS.map(m => (
        <button
          key={m.kind}
          role="menuitem"
          type="button"
          onClick={() => onPick(m.kind)}
          className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-secondary"
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
