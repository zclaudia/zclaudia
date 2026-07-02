import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const finishDraft = vi.fn();
const setLocalContent = vi.fn();
const openEditor = vi.fn();

let state: Record<string, unknown>;
function buildState() {
  return {
    localContent: '',
    isSaving: false,
    lastSavedAt: null,
    isReadOnly: false,
    activeSessionId: 'sess-1',
    sessionArchived: false,
    sendCallback: vi.fn(),
    setLocalContent,
    closeEditor: vi.fn(),
    finishDraft,
    discardDraft: vi.fn(),
  };
}

vi.mock('../../../stores/draftEditorStore', () => ({
  useDraftEditorStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => (sel ? sel(state) : state),
    { getState: () => ({ ...state, openEditor }) }
  ),
}));
vi.mock('../../../stores/selectionStore', () => ({
  useSelectionStore: (sel: (s: { selectedSessionId: string }) => unknown) =>
    sel({ selectedSessionId: 'sess-1' }),
}));

import { DraftPanel } from '../DraftPanel';

describe('DraftPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state = buildState();
  });

  it('shows the value-communicating empty state when empty', () => {
    render(<DraftPanel />);
    expect(screen.getByText(/auto-saves and syncs/i)).toBeTruthy();
  });

  it('has no footer Close or Finish buttons', () => {
    render(<DraftPanel />);
    expect(screen.queryByText('Close')).toBeNull();
    expect(screen.queryByText('Finish & Send')).toBeNull();
    expect(screen.queryByText('Discard')).toBeNull();
  });

  it('sends on Cmd+Enter', () => {
    state = { ...buildState(), localContent: 'hi' };
    render(<DraftPanel />);
    const ta = screen.getByLabelText('Draft message');
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
    expect(finishDraft).toHaveBeenCalledWith(state.sendCallback);
  });

  it('does not edit on Tab when archived (read-only)', () => {
    state = { ...buildState(), sessionArchived: true };
    render(<DraftPanel />);
    const ta = screen.getByLabelText('Draft message');
    fireEvent.keyDown(ta, { key: 'Tab' });
    expect(setLocalContent).not.toHaveBeenCalled();
  });

  it('inserts two spaces on Tab', () => {
    state = { ...buildState(), localContent: 'ab' };
    render(<DraftPanel />);
    const ta = screen.getByLabelText('Draft message');
    ta.focus();
    ta.setSelectionRange(2, 2);
    fireEvent.keyDown(ta, { key: 'Tab' });
    expect(setLocalContent).toHaveBeenCalledWith('ab  ');
  });
});
