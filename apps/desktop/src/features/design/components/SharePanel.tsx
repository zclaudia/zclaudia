import { Modal } from '../../../components/ui/Modal';
import { ShareContent } from './ShareContent';
import type { ShareContentProps } from './ShareContent';

export type SharePanelProps = ShareContentProps;

/**
 * Modal compatibility shell; the share management state machine and its
 * actions live in ShareContent so the consolidated Export & Share dialog can
 * reuse them.
 */
export function SharePanel(props: SharePanelProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      ariaLabel="Share"
      title="Share"
      size="2xl"
    >
      <ShareContent {...props} />
    </Modal>
  );
}
