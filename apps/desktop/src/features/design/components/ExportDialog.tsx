import { Modal } from '../../../components/ui/Modal';
import { ExportDialogContent } from './ExportDialogContent';
import type { ExportDialogContentProps } from './ExportDialogContent';

export type ExportDialogProps = ExportDialogContentProps;

/**
 * Modal compatibility shell; the export state machine and its actions live in
 * ExportDialogContent so the consolidated Export & Share dialog can reuse them.
 */
export function ExportDialog(props: ExportDialogProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      ariaLabel="Export"
      title="Export"
      size="md"
    >
      <ExportDialogContent {...props} />
    </Modal>
  );
}
