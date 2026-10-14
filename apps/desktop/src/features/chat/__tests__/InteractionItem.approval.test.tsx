import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InteractionItem } from '../InteractionItem';
import { useInteractionStore } from '../../../stores/interactionStore';

const { sendMessage, sendToServer } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  sendToServer: vi.fn(),
}));

vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({ sendMessage, sendToServer }),
}));

describe('approval interaction routing', () => {
  beforeEach(() => {
    sendMessage.mockClear();
    sendToServer.mockClear();
    useInteractionStore.setState({ interactions: {}, expiredReasons: {}, owners: {} });
  });

  it('sends a backend-owned approval through its owner even when another backend is active', () => {
    const interaction = {
      type: 'interaction_approval' as const,
      interactionId: 'approval-b',
      sessionId: 'shared-session',
      source: 'tool_call' as const,
      createdAt: 1,
      title: 'Approve B action',
      message: 'Review the Backend B action.',
    };
    useInteractionStore.setState({
      interactions: { [interaction.interactionId]: interaction },
      expiredReasons: {},
      owners: { [interaction.interactionId]: { serverId: 'backend-b', runId: 'run-b' } },
    });

    render(<InteractionItem interaction={interaction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(sendToServer).toHaveBeenCalledWith('backend-b', {
      type: 'interaction_response',
      interactionId: 'approval-b',
      sessionId: 'shared-session',
      response: { approved: true },
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
