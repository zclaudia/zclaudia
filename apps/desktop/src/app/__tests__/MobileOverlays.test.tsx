import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileOverlays } from '../MobileOverlays';

vi.mock('../../features/claudia/ClaudiaChat', () => ({
  ClaudiaChat: () => <div data-testid="claudia-chat" />,
}));

vi.mock('../../components/notifications/NotificationsPanel', () => ({
  NotificationsPanel: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="notifications-panel">
      {onClose && (
        <button type="button" aria-label="Close notifications" onClick={onClose}>
          x
        </button>
      )}
    </div>
  ),
}));

function renderOverlays(
  props: { isAgentExpanded?: boolean; isFeedOpen?: boolean; padFeedTopInset?: boolean } = {}
) {
  const onCloseFeed = vi.fn();
  render(
    <MobileOverlays
      isAgentExpanded={props.isAgentExpanded ?? false}
      isFeedOpen={props.isFeedOpen ?? false}
      padFeedTopInset={props.padFeedTopInset ?? false}
      agentSwipePreview={{ mode: null, progress: 0 }}
      claudiaSwipePreviewProgress={0}
      claudiaOverlayOpacity={0}
      onCloseFeed={onCloseFeed}
    />
  );
  return { onCloseFeed };
}

describe('MobileOverlays', () => {
  it('has no edge close tab on the Claudia overlay', () => {
    renderOverlays({ isAgentExpanded: true });
    expect(screen.getByTestId('claudia-chat')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close Claudia' })).toBeNull();
  });

  it('closes the feed through the notifications panel header', () => {
    const { onCloseFeed } = renderOverlays({ isFeedOpen: true });
    expect(screen.queryByTitle('Close Feed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close notifications' }));
    expect(onCloseFeed).toHaveBeenCalledTimes(1);
  });

  it('pads the feed below the status bar only when no shell header sits above it', () => {
    renderOverlays({ isFeedOpen: true, padFeedTopInset: true });
    expect(screen.getByTestId('notifications-panel').parentElement?.className).toContain(
      'safe-top-pad'
    );
  });

  it('leaves the feed unpadded under a shell header', () => {
    renderOverlays({ isFeedOpen: true });
    expect(screen.getByTestId('notifications-panel').parentElement?.className).not.toContain(
      'safe-top-pad'
    );
  });
});
