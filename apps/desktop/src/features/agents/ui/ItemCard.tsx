import { BotMessageSquare, Lightbulb, Database, Plug } from 'lucide-react';
import type { LibraryItem, LibraryItemKind } from '../agents-types';
import { Badge } from './Badge';

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

export function ItemCard({
  item,
  backendName,
  backendOnline,
  onOpen,
}: {
  item: LibraryItem;
  backendName: string;
  backendOnline: boolean;
  onOpen: () => void;
}) {
  const Icon = KIND_ICON[item.kind];
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={item.title}
      className="flex flex-col gap-2 rounded-xl border border-border/60 bg-secondary/30 p-3 text-left transition-colors hover:border-border hover:bg-secondary/50"
    >
      <div className="flex items-center justify-between">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <Badge label={KIND_LABEL[item.kind]} tone={item.kind === 'profile' ? 'accent' : 'neutral'} />
      </div>
      <div className="text-sm font-medium text-foreground">{item.title}</div>
      {item.subtitle && (
        <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div>
      )}
      <div className="mt-0.5 flex items-center gap-1.5">
        <Badge label={backendName} online={backendOnline} />
        {item.status && <Badge label={item.status} tone="accent" />}
      </div>
    </button>
  );
}
