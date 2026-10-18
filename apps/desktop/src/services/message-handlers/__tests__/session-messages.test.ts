import { describe, it, expect, beforeEach } from 'vitest';
import { handleSessionMessage } from '../session-messages';
import { useProjectStore } from '../../../stores/projectStore';
import { useToastStore } from '../../../stores/toastStore';

describe('handleSessionMessage sessions_updated', () => {
  beforeEach(() => {
    useProjectStore.setState({ sessions: [] });
    useToastStore.setState({ toasts: [] });
  });

  it('toasts when an unnamed session reports a title failure', () => {
    handleSessionMessage({
      type: 'sessions_updated',
      session: { id: 's1', autoTitlePending: false, autoTitleError: 'boom' },
    } as never);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('error');
    expect(toasts[0].sessionId).toBe('s1');
    expect(toasts[0].message).toContain('boom');
  });

  it('stays silent for titled or named sessions and successful updates', () => {
    const cases = [
      { id: 's1', name: 'Named', autoTitleError: 'boom' },
      { id: 's1', autoTitle: 'Titled', autoTitleError: 'boom' },
      { id: 's1', autoTitleError: undefined },
    ];
    for (const session of cases) {
      handleSessionMessage({ type: 'sessions_updated', session } as never);
    }
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
