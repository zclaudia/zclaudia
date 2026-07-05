import type { AgentReadinessReason } from '@zclaudia/shared/core/agent-readiness';
import { readinessGuidance, type ReadinessDestination } from './readiness-copy';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useAndroidBack } from '../../hooks/useAndroidBack';

interface AgentRequiredDialogProps {
  open: boolean;
  reason: AgentReadinessReason | undefined;
  onClose: () => void;
  onConfigure: (destination: ReadinessDestination) => void;
}

export function AgentRequiredDialog({
  open,
  reason,
  onClose,
  onConfigure,
}: AgentRequiredDialogProps) {
  const isMobile = useIsMobile();
  useAndroidBack(onClose, isMobile && open, 25);
  if (!open) return null;

  const g = readinessGuidance(reason);

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div
        className={`fixed z-50 bg-card flex flex-col ${
          isMobile
            ? 'inset-0 safe-top-pad safe-bottom-pad'
            : 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] max-h-[80vh] rounded-lg shadow-2xl'
        }`}
        role="dialog"
        aria-modal="true"
      >
        <div className="px-5 pt-5 pb-2">
          <h2 className="text-base font-medium text-foreground">{g.title}</h2>
        </div>
        <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed">{g.body}</div>
        <div className="flex gap-2 px-5 pb-5 mt-auto">
          <button
            onClick={() => onConfigure(g.destination)}
            className="flex-1 px-3 py-2 bg-accent text-foreground font-medium shadow-apple-sm hover:bg-accent/80 rounded-lg text-sm"
          >
            Configure →
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
