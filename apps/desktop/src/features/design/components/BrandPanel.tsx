import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { BrandView } from '../rail/BrandView';
import type { BrandViewProps } from '../rail/BrandView';

export interface BrandPanelProps
  extends Omit<BrandViewProps, 'active' | 'compact' | 'resetOnHide'> {
  open: boolean;
  onClose: () => void;
}

/** Modal compatibility shell; the brand editor and its state live in BrandView. */
export function BrandPanel({
  open,
  backendId,
  sessionId,
  onClose,
  onSaved,
}: BrandPanelProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Brand"
      title="Brand"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <BrandView
        active={open}
        backendId={backendId}
        sessionId={sessionId}
        onSaved={onSaved}
        resetOnHide
      />
    </Modal>
  );
}
