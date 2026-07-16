import { useState } from 'react';
import { BotMessageSquare, Lightbulb, Database, MoreHorizontal, Plug } from 'lucide-react';
import type { LibraryItem, LibraryItemKind } from '../agents-types';
import { Badge } from './Badge';
import { StatusChip } from '../../../components/ui/StatusChip';

const KIND_ICON: Record<LibraryItemKind, typeof Plug> = {
  profile: BotMessageSquare,
  skill: Lightbulb,
  'mcp-server': Database,
  'llm-profile': Plug,
};

const KIND_LABEL: Record<LibraryItemKind, string> = {
  profile: 'Profile',
  skill: 'Skill',
  'mcp-server': 'MCP',
  'llm-profile': 'Provider',
};

export interface ItemCardAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export function ItemCard({
  item,
  backendName,
  backendOnline,
  onOpen,
  actions,
}: {
  item: LibraryItem;
  backendName: string;
  backendOnline: boolean;
  onOpen: () => void;
  actions?: ItemCardAction[];
}) {
  const Icon = KIND_ICON[item.kind];
  const [menuOpen, setMenuOpen] = useState(false);
  const content = (
    <>
      <div className="flex items-center justify-between">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <Badge label={KIND_LABEL[item.kind]} tone={item.kind === 'profile' ? 'accent' : 'neutral'} />
      </div>
      <div className="text-sm font-medium text-foreground">{item.title}</div>
      {item.subtitle && <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div>}
      <div className="mt-0.5 flex items-center gap-1.5">
        <Badge label={backendName} online={backendOnline} />
        {item.status && <Badge label={item.status} tone="accent" />}
        {item.recordStatus && <StatusChip status={item.recordStatus} />}
      </div>
    </>
  );

  if (actions && actions.length > 0) {
    return (
      <div className="relative rounded-xl bg-secondary/30">
        <button
          type="button"
          onClick={onOpen}
          aria-label={item.title}
          className="absolute inset-0 rounded-xl border border-border/60 transition-colors hover:border-border hover:bg-secondary/50"
        />
        <div className="pointer-events-none relative flex flex-col gap-2 p-3">{content}</div>
        <div className="absolute bottom-2.5 right-2.5 z-10">
          <button
            type="button"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(open => !open)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <MoreHorizontal size={16} strokeWidth={1.75} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-[70]" onClick={() => setMenuOpen(false)} />
              <div
                role="menu"
                className="absolute right-0 top-full z-[80] mt-1 min-w-48 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md"
              >
                {actions.map(action => (
                  <button
                    key={action.label}
                    role="menuitem"
                    type="button"
                    disabled={action.disabled}
                    onClick={() => {
                      setMenuOpen(false);
                      action.onSelect();
                    }}
                    className={`flex w-full px-3 py-1.5 text-left text-xs hover:bg-secondary disabled:pointer-events-none disabled:opacity-50 ${
                      action.destructive ? 'text-destructive hover:bg-destructive/10' : 'text-foreground'
                    }`}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={item.title}
      className="flex flex-col gap-2 rounded-xl border border-border/60 bg-secondary/30 p-3 text-left transition-colors hover:border-border hover:bg-secondary/50"
    >
      {content}
    </button>
  );
}
