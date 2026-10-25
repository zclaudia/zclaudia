import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { TemplateView } from '../rail/TemplateView';
import type { TemplateViewProps } from '../rail/TemplateView';

export interface TemplateDialogProps
  extends Omit<TemplateViewProps, 'active' | 'compact' | 'openEntryOnInstall'> {
  open: boolean;
  onClose: () => void;
}

/** Modal compatibility shell; the template browser and its state live in TemplateView. */
export function TemplateDialog({
  open,
  backendId,
  sessionId,
  onClose,
  onInstalled,
}: TemplateDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Templates"
      title="Templates"
      size="lg"
      footer={
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <TemplateView
        active={open}
        backendId={backendId}
        sessionId={sessionId}
        onInstalled={onInstalled}
      />
    </Modal>
  );
}
