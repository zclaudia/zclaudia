import { Modal } from '../../../components/ui/Modal';
import { RenderExportContent } from './RenderExportContent';
import type { RenderExportContentProps } from './RenderExportContent';

export type RenderExportDialogProps = RenderExportContentProps;

/**
 * Modal compatibility shell; the render-export state machine and its actions
 * live in RenderExportContent so the consolidated Export & Share dialog can
 * reuse them.
 */
export function RenderExportDialog(props: RenderExportDialogProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      ariaLabel="Render export"
      title="Render export"
      size="md"
    >
      <RenderExportContent {...props} />
    </Modal>
  );
}
