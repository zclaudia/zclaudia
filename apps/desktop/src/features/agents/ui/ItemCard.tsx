import { BotMessageSquare, Lightbulb, Database, Plug } from 'lucide-react';
import type { LibraryItem, LibraryItemKind } from '../agents-types';
import { Badge } from './Badge';
import { StatusChip } from '../../../components/ui/StatusChip';
import { ActionsMenu } from './ActionsMenu';
import type { ActionsMenuAction } from './ActionsMenu';

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

export type ItemCardAction = ActionsMenuAction;

export function ItemCard({
  item,
  backendName,
  backendOnline,
  showBackendBadge = true,
  onOpen,
  actions,
}: {
  item: LibraryItem;
  backendName: string;
  backendOnline: boolean;
  /** Set false when the surrounding view already groups cards by backend. */
  showBackendBadge?: boolean;
  onOpen: () => void;
  actions?: ItemCardAction[];
}) {
  const Icon = KIND_ICON[item.kind];
  const content = (
    <>
      <div className="flex items-center justify-between">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <Badge
          label={KIND_LABEL[item.kind]}
          tone={item.kind === 'profile' ? 'accent' : 'neutral'}
        />
      </div>
      <div className="text-sm font-medium text-foreground">{item.title}</div>
      {item.subtitle && (
        <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div>
      )}
      {(showBackendBadge || item.status || item.recordStatus) && (
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
          {showBackendBadge && <Badge label={backendName} online={backendOnline} />}
          {item.status && <Badge label={item.status} tone="accent" />}
          {item.recordStatus && <StatusChip status={item.recordStatus} />}
        </div>
      )}
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
          <ActionsMenu actions={actions} />
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
