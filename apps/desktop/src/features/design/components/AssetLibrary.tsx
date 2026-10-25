import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { AssetLibraryView } from '../rail/AssetLibraryView';
import type { AssetLibraryViewProps } from '../rail/AssetLibraryView';

export interface AssetLibraryProps extends Omit<AssetLibraryViewProps, 'active' | 'compact'> {
  open: boolean;
  onClose: () => void;
}

/** Modal compatibility shell; the asset browser and its state live in AssetLibraryView. */
export function AssetLibrary({
  open,
  backendId,
  sessionId,
  openPages,
  referencedAssets,
  activeDocPath,
  selection,
  onApply,
  onImported,
  onClose,
}: AssetLibraryProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Asset library"
      title="Asset library"
      size="2xl"
      footer={
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <AssetLibraryView
        active={open}
        backendId={backendId}
        sessionId={sessionId}
        openPages={openPages}
        referencedAssets={referencedAssets}
        activeDocPath={activeDocPath}
        selection={selection}
        onApply={onApply}
        onImported={onImported}
      />
    </Modal>
  );
}
