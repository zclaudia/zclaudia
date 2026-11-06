import { ClaudiaChat } from '../features/claudia/ClaudiaChat';
import { NotificationsPanel } from '../components/notifications/NotificationsPanel';

interface MobileOverlaysProps {
  isAgentExpanded: boolean;
  isFeedOpen: boolean;
  /** No shell header sits above the feed, so it must clear the status bar itself. */
  padFeedTopInset: boolean;
  agentSwipePreview: { mode: 'open' | 'close' | null; progress: number };
  claudiaSwipePreviewProgress: number;
  claudiaOverlayOpacity: number;
  onCloseFeed: () => void;
}

export function MobileOverlays({
  isAgentExpanded,
  isFeedOpen,
  padFeedTopInset,
  agentSwipePreview,
  claudiaSwipePreviewProgress,
  claudiaOverlayOpacity,
  onCloseFeed,
}: MobileOverlaysProps) {
  return (
    <>
      {/* Dim overlay */}
      {(isAgentExpanded ||
        agentSwipePreview.mode === 'open' ||
        agentSwipePreview.mode === 'close') && (
        <div
          className={`absolute inset-0 z-10 bg-black/100 ${
            agentSwipePreview.mode
              ? 'transition-none'
              : 'transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
          }`}
          style={{
            opacity: claudiaOverlayOpacity,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Agent panel (always mounted to preserve state) */}
      <div
        className={`absolute inset-0 z-20 bg-background will-change-transform ${
          isAgentExpanded || agentSwipePreview.mode === 'open' ? '' : 'hidden'
        } ${
          agentSwipePreview.mode
            ? 'transition-none'
            : 'transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
        }`}
        style={{
          transform: isAgentExpanded
            ? `translateX(${agentSwipePreview.mode === 'close' ? claudiaSwipePreviewProgress * 100 : 0}%)`
            : `translateX(${(1 - (agentSwipePreview.mode === 'open' ? claudiaSwipePreviewProgress : 0)) * 100}%)`,
          pointerEvents: isAgentExpanded ? 'auto' : 'none',
          boxShadow:
            isAgentExpanded || agentSwipePreview.mode === 'open'
              ? `-16px 0 40px rgba(0, 0, 0, ${0.14 + claudiaSwipePreviewProgress * 0.08})`
              : 'none',
        }}
      >
        <ClaudiaChat isMobile={true} />
      </div>

      {/* Feed panel */}
      {isFeedOpen && (
        <div
          className={`absolute inset-0 z-20 bg-background ${padFeedTopInset ? 'safe-top-pad' : ''}`}
        >
          <NotificationsPanel onClose={onCloseFeed} />
        </div>
      )}
    </>
  );
}
