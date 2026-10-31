import type { ComponentProps } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { useIsMobile } from '../../../hooks/useMediaQuery';

/** Design dialogs share the mobile host's back handling and touch sizing. */
export function DesignModal(props: ComponentProps<typeof Modal>) {
  const isMobile = useIsMobile();
  return (
    <Modal
      {...props}
      isMobile={isMobile}
      mobileFullscreen={isMobile}
      zClassName={`${props.zClassName ?? 'z-[100]'}${isMobile ? ' design-mobile-dialog' : ''}`}
    />
  );
}
