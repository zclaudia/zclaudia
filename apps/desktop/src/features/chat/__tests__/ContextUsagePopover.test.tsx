import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ContextUsagePayload } from '@zclaudia/shared';
import { StrictModeTestWrapper } from '../../../test/StrictModeTestWrapper';
import { ContextUsagePopover } from '../ContextUsagePopover';

// The component imports the named fetch from the api index; mock just that.
vi.mock('../../../services/api', () => ({
  getSessionContextUsage: vi.fn(),
}));
import { getSessionContextUsage } from '../../../services/api';

const mockFetch = vi.mocked(getSessionContextUsage);

function payload(): ContextUsagePayload {
  return {
    model: 'claude-sonnet-4-6',
    contextWindow: 200_000,
    contextWindowSource: 'pi_ai_registry',
    usedTokens: 25_900,
    usedTokensFromUsage: true,
    breakdown: {
      systemPrompt: { tokens: 2_900, estimated: true },
      tools: { tokens: 5_600, estimated: true, count: 12 },
      skills: { tokens: 8_800, estimated: true },
      messages: { tokens: 8_600, estimated: true, clamped: false },
      freeSpace: { tokens: 174_100, percent: 87.1 },
    },
    capturedAt: 1_770_000_000_000,
  };
}

function renderPopover() {
  return render(
    <ContextUsagePopover sessionId="s1">
      <span>indicator</span>
    </ContextUsagePopover>
  );
}

beforeEach(() => {
  mockFetch.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ContextUsagePopover', () => {
  it('does not open immediately on hover, then opens and renders the card', async () => {
    mockFetch.mockResolvedValue({ available: true, ...payload() });
    const { container } = renderPopover();
    const anchor = container.firstChild as HTMLElement;

    fireEvent.mouseEnter(anchor);
    // Open is delayed — the card must not be present synchronously.
    expect(screen.queryByTestId('context-usage-card')).toBeNull();

    await screen.findByTestId('context-usage-card');
    expect(mockFetch).toHaveBeenCalledWith('s1');
  });

  it('still resolves under StrictMode (mount/cleanup/remount must not strand it on loading)', async () => {
    // StrictMode double-invokes the mount effect: run → cleanup → run. The
    // cleanup flips mountedRef to false, so the effect body must flip it back
    // to true or every fetch result is dropped and the popover sticks on
    // "Loading…". The real app wraps the tree in StrictMode; tests must too.
    mockFetch.mockResolvedValue({ available: true, ...payload() });
    const { container } = render(
      <StrictModeTestWrapper>
        <ContextUsagePopover sessionId="s1">
          <span>indicator</span>
        </ContextUsagePopover>
      </StrictModeTestWrapper>
    );
    fireEvent.mouseEnter(container.firstChild as HTMLElement);
    await screen.findByTestId('context-usage-card');
  });

  it('renders the empty state when no context data is available', async () => {
    mockFetch.mockResolvedValue({ available: false });
    const { container } = renderPopover();
    fireEvent.mouseEnter(container.firstChild as HTMLElement);

    await screen.findByTestId('context-usage-popover-empty');
    expect(screen.queryByTestId('context-usage-card')).toBeNull();
  });

  it('stays open when the mouse bridges from anchor to popover, closes when leaving both', async () => {
    mockFetch.mockResolvedValue({ available: true, ...payload() });
    const { container } = renderPopover();
    const anchor = container.firstChild as HTMLElement;

    fireEvent.mouseEnter(anchor);
    const card = await screen.findByTestId('context-usage-card');
    const popover = card.closest('[data-testid="context-usage-popover"]') as HTMLElement;

    // Leave the anchor but enter the popover within the close delay (bridge).
    fireEvent.mouseLeave(anchor);
    fireEvent.mouseEnter(popover);
    await new Promise(r => setTimeout(r, 250));
    expect(screen.queryByTestId('context-usage-card')).not.toBeNull();

    // Leave the popover too — it closes after the delay.
    fireEvent.mouseLeave(popover);
    await waitFor(() => expect(screen.queryByTestId('context-usage-card')).toBeNull());
  });

  it('shows a prompt-cache line when latestCacheRead > 0', async () => {
    mockFetch.mockResolvedValue({ available: true, ...payload() });
    const { container } = render(
      <ContextUsagePopover sessionId="s1" latestCacheRead={4200}>
        <span>indicator</span>
      </ContextUsagePopover>
    );
    fireEvent.mouseEnter(container.firstChild as HTMLElement);
    await screen.findByTestId('context-usage-card');
    expect(screen.getByTestId('popover-cache-line').textContent).toMatch(
      /Prompt cache:\s*4K read this turn/i
    );
  });

  it('opens immediately on tap/click (no hover delay) and closes on a second tap', async () => {
    mockFetch.mockResolvedValue({ available: true, ...payload() });
    const { container } = renderPopover();
    const anchor = container.firstChild as HTMLElement;

    fireEvent.click(anchor);
    // Click opens synchronously — the popover shell is present before the fetch resolves.
    expect(screen.queryByTestId('context-usage-popover')).not.toBeNull();
    await screen.findByTestId('context-usage-card');
    expect(mockFetch).toHaveBeenCalledWith('s1');

    fireEvent.click(anchor);
    expect(screen.queryByTestId('context-usage-popover')).toBeNull();
  });

  it('stays open when clicking inside the panel (portal clicks bubble to the anchor)', async () => {
    mockFetch.mockResolvedValue({ available: true, ...payload() });
    const { container } = renderPopover();
    fireEvent.click(container.firstChild as HTMLElement);
    const card = await screen.findByTestId('context-usage-card');

    // The panel is portaled but remains a React-tree child of the anchor, so
    // this click reaches the anchor's onClick — it must not toggle closed.
    fireEvent.click(card);
    expect(screen.queryByTestId('context-usage-popover')).not.toBeNull();
  });

  it('closes on anchor click after opening via hover (hover/click interleaving)', async () => {
    mockFetch.mockResolvedValue({ available: true, ...payload() });
    const { container } = renderPopover();
    const anchor = container.firstChild as HTMLElement;

    fireEvent.mouseEnter(anchor);
    await screen.findByTestId('context-usage-card');

    fireEvent.click(anchor);
    expect(screen.queryByTestId('context-usage-popover')).toBeNull();
  });

  it('closes on tap outside the anchor and panel', async () => {
    mockFetch.mockResolvedValue({ available: true, ...payload() });
    const { container } = renderPopover();
    fireEvent.click(container.firstChild as HTMLElement);
    await screen.findByTestId('context-usage-card');

    // Pointerdown inside the panel must not dismiss it.
    fireEvent.pointerDown(screen.getByTestId('context-usage-popover'));
    expect(screen.queryByTestId('context-usage-popover')).not.toBeNull();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('context-usage-popover')).toBeNull();
  });

  it('closes on Escape', async () => {
    mockFetch.mockResolvedValue({ available: true, ...payload() });
    const { container } = renderPopover();
    fireEvent.click(container.firstChild as HTMLElement);
    await screen.findByTestId('context-usage-card');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('context-usage-popover')).toBeNull();
  });

  it('omits the prompt-cache line when latestCacheRead is 0 or absent', async () => {
    mockFetch.mockResolvedValue({ available: true, ...payload() });
    const { container } = render(
      <ContextUsagePopover sessionId="s1" latestCacheRead={0}>
        <span>indicator</span>
      </ContextUsagePopover>
    );
    fireEvent.mouseEnter(container.firstChild as HTMLElement);
    await screen.findByTestId('context-usage-card');
    expect(screen.queryByTestId('popover-cache-line')).toBeNull();
  });
});
