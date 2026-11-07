import type { RefObject } from 'react';
import { ClaudiaChat } from '../features/claudia/ClaudiaChat';
import { NotificationsPanel } from '../components/notifications/NotificationsPanel';

interface MobileOverlaysProps {
  isAgentExpanded: boolean;
  isFeedOpen: boolean;
  padFeedTopInset: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
  backdropRef: RefObject<HTMLDivElement | null>;
  onCloseFeed: () => void;
}

export function MobileOverlays({ isFeedOpen, padFeedTopInset, panelRef, backdropRef, onCloseFeed }: MobileOverlaysProps) {
  return (
    <>
      <div ref={backdropRef} className="absolute inset-0 z-10 bg-black/100" style={{ opacity: 0, visibility: 'hidden', pointerEvents: 'none' }} />
      <div data-mobile-claudia-surface ref={panelRef} className="absolute inset-0 z-20 bg-background will-change-transform"
        style={{ visibility: 'hidden', pointerEvents: 'none', boxShadow: '-16px 0 40px rgba(0, 0, 0, 0.18)' }}>
        <ClaudiaChat isMobile={true} />
      </div>
      {isFeedOpen && (
        <div className={`absolute inset-0 z-20 bg-background ${padFeedTopInset ? 'safe-top-pad' : ''}`}>
          <NotificationsPanel onClose={onCloseFeed} />
        </div>
      )}
    </>
  );
}
