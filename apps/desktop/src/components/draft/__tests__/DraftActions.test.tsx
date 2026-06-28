import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const finishDraft = vi.fn();
const discardDraft = vi.fn().mockResolvedValue(undefined);
const openDraftInNewWindow = vi.fn().mockResolvedValue(undefined);

let state: Record<string, unknown>;
function buildState() {
  return {
    localContent: 'hello world',
    isSaving: false,
    lastSavedAt: 123,
    isReadOnly: false,
    sessionArchived: false,
    activeSessionId: 'sess-1',
    sendCallback: vi.fn(),
    finishDraft,
    discardDraft,
  };
}

vi.mock('../../../stores/draftEditorStore', () => ({
  useDraftEditorStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  ),
}));
vi.mock('../../../utils/openDraftWindow', () => ({
  openDraftInNewWindow: (...a: unknown[]) => openDraftInNewWindow(...a),
}));
vi.mock('../../../utils/platform', () => ({ isDesktopTauri: () => true }));

import { DraftActions } from '../DraftActions';

describe('DraftActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state = buildState();
  });

  it('shows the saved status and char count', () => {
    render(<DraftActions />);
    expect(screen.getByText(/Saved/)).toBeTruthy();
    expect(screen.getByText(/11 chars/)).toBeTruthy();
  });

  it('sends to chat via finishDraft', () => {
    render(<DraftActions />);
    fireEvent.click(screen.getByLabelText('Send to chat'));
    expect(finishDraft).toHaveBeenCalledWith(state.sendCallback);
  });

  it('disables Send when content is empty', () => {
    state = { ...buildState(), localContent: '   ' };
    render(<DraftActions />);
    expect(screen.getByLabelText('Send to chat')).toHaveProperty('disabled', true);
  });

  it('requires two clicks to discard', () => {
    render(<DraftActions />);
    fireEvent.click(screen.getByLabelText('Discard draft'));
    expect(discardDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Confirm discard draft'));
    expect(discardDraft).toHaveBeenCalledTimes(1);
  });

  it('pops out the active session draft', () => {
    render(<DraftActions />);
    fireEvent.click(screen.getByLabelText('Open draft in new window'));
    expect(openDraftInNewWindow).toHaveBeenCalledWith('sess-1');
  });

  it('hides Send when archived', () => {
    state = { ...buildState(), sessionArchived: true };
    render(<DraftActions />);
    expect(screen.queryByLabelText('Send to chat')).toBeNull();
  });

  it('hides Send when read-only', () => {
    state = { ...buildState(), isReadOnly: true };
    render(<DraftActions />);
    expect(screen.queryByLabelText('Send to chat')).toBeNull();
  });

  it('shows a Read Only badge when read-only and not archived', () => {
    state = { ...buildState(), isReadOnly: true };
    render(<DraftActions />);
    expect(screen.getByText('Read Only')).toBeTruthy();
  });

  describe('discard confirm auto-reset', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('resets the discard confirm after 3 seconds', () => {
      render(<DraftActions />);
      fireEvent.click(screen.getByLabelText('Discard draft'));
      expect(screen.getByLabelText('Confirm discard draft')).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(3001);
      });
      expect(screen.getByLabelText('Discard draft')).toBeTruthy();
      expect(discardDraft).not.toHaveBeenCalled();
    });
  });
});
