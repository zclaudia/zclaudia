import { memo, useCallback } from 'react';
import { Compass, Trash2, Paperclip } from 'lucide-react';
import { useSendQueueStore, type QueueItem } from '../../stores/sendQueueStore';

interface SendQueueBarProps {
  sessionId: string;
  /** True when there is an active run that can receive a steer. Drives the
   *  availability of the "Steer now" action per item. */
  canSteer: boolean;
  /** Inject a queued item into the live run via run_steer, then remove it. */
  onSteer: (item: QueueItem) => void;
}

function attachmentCount(item: QueueItem): number {
  return item.attachments?.length ?? 0;
}

const ItemRow = memo(function ItemRow({
  item,
  canSteer,
  onSteer,
  onRemove,
}: {
  item: QueueItem;
  canSteer: boolean;
  onSteer: (item: QueueItem) => void;
  onRemove: (item: QueueItem) => void;
}) {
  const hasAttachments = attachmentCount(item) > 0;
  // Steer can't carry attachments (server rejects them mid-run), so for items
  // with attachments the steer action is disabled — they must wait & ship new.
  const steerDisabled = !canSteer || hasAttachments;
  const steerTitle = !canSteer
    ? 'No active run to steer right now'
    : hasAttachments
    ? "Queued items with attachments can't be steered — they'll send as a new run"
    : 'Inject into the active run now (delivered next turn)';

  return (
    <div
      className="group flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm shadow-apple-sm"
      data-testid="send-queue-item"
      data-item-id={item.id}
    >
      <Compass size={14} className="mt-0.5 flex-shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap break-words text-foreground/90 leading-snug line-clamp-3">
          {item.content || <span className="italic text-muted-foreground">(empty)</span>}
        </p>
        {hasAttachments && (
          <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Paperclip size={11} />
            {attachmentCount(item)} attachment{attachmentCount(item) > 1 ? 's' : ''}
          </div>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onSteer(item)}
          disabled={steerDisabled}
          title={steerTitle}
          aria-label="Steer now"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:bg-transparent"
        >
          <Compass size={12} />
          Steer
        </button>
        <button
          type="button"
          onClick={() => onRemove(item)}
          title="Remove from queue"
          aria-label="Remove from queue"
          className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
});

/**
 * Inline stack of queued messages shown above the composer while a run is
 * active. Each item waits (queued) to ship as a new run when the current run
 * ends; the user may also "Steer now" to inject an item mid-run, or remove it.
 */
export function SendQueueBar({ sessionId, canSteer, onSteer }: SendQueueBarProps) {
  const items = useSendQueueStore((s) => s.queues[sessionId] ?? []);
  const removeItem = useSendQueueStore((s) => s.removeItem);

  const handleRemove = useCallback((item: QueueItem) => {
    removeItem(sessionId, item.id);
  }, [removeItem, sessionId]);

  if (items.length === 0) return null;

  return (
    <div className="mb-1.5 flex flex-col gap-1.5" data-testid="send-queue-bar">
      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Compass size={12} />
          Queued — sends after this run
        </span>
        <span>{items.length} queued</span>
      </div>
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          canSteer={canSteer}
          onSteer={onSteer}
          onRemove={handleRemove}
        />
      ))}
    </div>
  );
}
