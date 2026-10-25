import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { MediaGenView } from '../rail/MediaGenView';
import type { MediaGenViewProps } from '../rail/MediaGenView';

export interface MediaGenPanelProps
  extends Omit<MediaGenViewProps, 'active' | 'compact' | 'resetOnHide'> {
  open: boolean;
  onClose: () => void;
}

/** Modal compatibility shell; the media generator and its state live in MediaGenView. */
export function MediaGenPanel({
  open,
  onClose,
  backendId,
  sessionId,
  activeDocPath,
  imageSelectionReady,
  onReplaceSelectionSrc,
  onAssetImported,
}: MediaGenPanelProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Media generation"
      title="Media generation"
      size="2xl"
      footer={
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <MediaGenView
        active={open}
        backendId={backendId}
        sessionId={sessionId}
        activeDocPath={activeDocPath}
        imageSelectionReady={imageSelectionReady}
        onReplaceSelectionSrc={onReplaceSelectionSrc}
        onAssetImported={onAssetImported}
        resetOnHide
      />
    </Modal>
  );
}
