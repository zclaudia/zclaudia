import { AlertCircle, Check, Circle, Loader2 } from 'lucide-react';
import type { SaveStatus } from '../useProfileAutosave';

export function SaveStateIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry?: () => void;
}) {
  if (status === 'saving') {
    return (
      <span
        data-testid="save-state"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span
        data-testid="save-state"
        title="Complete the required fields to save"
        className="inline-flex items-center gap-1.5 text-xs text-warning"
      >
        <Circle size={13} strokeWidth={1.75} />
        Not saved
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span
        data-testid="save-state"
        className="inline-flex items-center gap-1.5 text-xs text-destructive"
      >
        <AlertCircle size={13} strokeWidth={1.75} />
        Save failed
        <button
          type="button"
          onClick={onRetry}
          className="font-medium underline underline-offset-2 hover:text-destructive/80"
        >
          Retry
        </button>
      </span>
    );
  }
  return (
    <span
      data-testid="save-state"
      className="inline-flex items-center gap-1.5 text-xs text-success"
    >
      <Check size={13} strokeWidth={1.75} />
      Saved
    </span>
  );
}
