import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const finishDraft = vi.fn();
const discardDraft = vi.fn().mockResolvedValue(undefined);
const setPoppedOut = vi.fn();
const openDraftInNewWindow = vi.fn().mockResolvedValue('draft-window-1');

let state: Record<string, unknown>;
function buildState() {
  return {
    localContent: 'hello world',
    isSaving: false,
    lastSavedAt: 123,
    isReadOnly: false,
    sessionArchived: false,
    activeSessionId: 'sess-1',
    poppedOut: false,
    sendCallback: vi.fn(),
    finishDraft,
    discardDraft,
    setPoppedOut,
  };
}

vi.mock('../../../stores/draftEditorStore', () => ({
  useDraftEditorStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => (sel ? sel(state) : state),
    { getState: () => state }
  ),
}));
vi.mock('../../../actions/openDraftWindow', () => ({
  openDraftInNewWindow: (...a: unknown[]) => openDraftInNewWindow(...a),
}));
vi.mock('../../../utils/platform', () => ({ isDesktopTauri: () => true }));

import { DraftActions } from '../DraftActions';
import { WorkspaceToolContext } from '../../workspace/WorkspaceToolContext';

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

  it('does not expose actions for a different singleton draft during a binding switch', () => {
    render(
      <WorkspaceToolContext.Provider value={{ sessionId: 'other-chat' }}>
        <DraftActions />
      </WorkspaceToolContext.Provider>
    );
    expect(screen.queryByLabelText('Send to chat')).toBeNull();
    expect(screen.queryByLabelText('Discard draft')).toBeNull();
    expect(screen.queryByLabelText('Open draft in new window')).toBeNull();
  });

  it('does not expose the global draft actions for an empty workspace binding', () => {
    render(
      <WorkspaceToolContext.Provider value={{ sessionId: '' }}>
        <DraftActions />
      </WorkspaceToolContext.Provider>
    );
    expect(screen.queryByLabelText('Send to chat')).toBeNull();
    expect(screen.queryByLabelText('Discard draft')).toBeNull();
    expect(screen.queryByLabelText('Open draft in new window')).toBeNull();
  });

  it('resets discard confirmation when the active draft changes', () => {
    const { rerender } = render(<DraftActions />);
    fireEvent.click(screen.getByLabelText('Discard draft'));
    state = { ...state, activeSessionId: 'other-chat' };
    rerender(<DraftActions />);
    fireEvent.click(screen.getByLabelText('Discard draft'));
    expect(discardDraft).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Confirm discard draft')).toBeTruthy();
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

  it('does not mark a newly bound draft popped out after old window creation resolves', async () => {
    let resolve!: (label: string) => void;
    openDraftInNewWindow.mockReturnValueOnce(
      new Promise(done => {
        resolve = done;
      })
    );
    render(<DraftActions />);
    fireEvent.click(screen.getByLabelText('Open draft in new window'));
    state = { ...state, activeSessionId: 'other-chat' };
    await act(async () => resolve('old-draft-window'));
    expect(setPoppedOut).not.toHaveBeenCalled();
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

  it('hides the pop-out button when already popped out', () => {
    state = { ...buildState(), poppedOut: true };
    render(<DraftActions />);
    expect(screen.queryByLabelText('Open draft in new window')).toBeNull();
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
