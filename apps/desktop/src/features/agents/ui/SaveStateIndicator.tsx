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
        className="inline-flex h-5 items-center gap-1 text-2xs text-muted-foreground"
      >
        <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span
        data-testid="save-state"
        title="Complete the required fields to save"
        className="inline-flex h-5 items-center gap-1 text-2xs text-warning"
      >
        <Circle size={12} strokeWidth={1.75} />
        Not saved
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span
        data-testid="save-state"
        className="inline-flex h-5 items-center gap-1 text-2xs text-destructive"
      >
        <AlertCircle size={12} strokeWidth={1.75} />
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
      className="inline-flex h-5 items-center gap-1 text-2xs text-success"
    >
      <Check size={12} strokeWidth={1.75} />
      Saved
    </span>
  );
}
