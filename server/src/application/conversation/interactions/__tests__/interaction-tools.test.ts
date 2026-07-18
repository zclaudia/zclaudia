import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toolRegistry } from '../../../plugins/index.js';
import { interactionDispatcher } from '../interaction-dispatcher.js';
import { registerInteractionTools } from '../interaction-tools.js';

vi.mock('../interaction-dispatcher.js', () => ({
  interactionDispatcher: {
    dispatchAndWait: vi.fn(),
    dispatchFireAndForget: vi.fn(),
  },
}));

describe('registered interaction tools', () => {
  beforeEach(() => {
    toolRegistry.removeBySource('interaction');
    vi.clearAllMocks();
  });

  afterEach(() => {
    toolRegistry.removeBySource('interaction');
  });

  it('advertises cancelled as a valid update_todo_list status', () => {
    registerInteractionTools();

    const tool = toolRegistry.get('update_todo_list');
    const parameters = tool?.definition.function.parameters as any;
    const statuses = parameters.properties.todos.items.properties.status.enum;

    expect(statuses).toContain('cancelled');
  });

  it('ask_user_form waits indefinitely for the user (no dispatch timeout)', async () => {
    vi.mocked(interactionDispatcher.dispatchAndWait).mockResolvedValue({ proceed: 'yes' });
    registerInteractionTools();

    const tool = toolRegistry.get('ask_user_form');
    await tool!.handler(
      { title: 'Pick one', fields: [{ id: 'proceed', label: 'Proceed?', type: 'confirm' }] },
      { sessionId: 'session-1' }
    );

    expect(interactionDispatcher.dispatchAndWait).toHaveBeenCalledWith(
      expect.any(String),
      'session-1',
      expect.objectContaining({ type: 'interaction_prompt' }),
      null
    );
  });

  it('request_approval waits indefinitely for the user (no dispatch timeout)', async () => {
    vi.mocked(interactionDispatcher.dispatchAndWait).mockResolvedValue({ approved: true });
    registerInteractionTools();

    const tool = toolRegistry.get('request_approval');
    await tool!.handler(
      { title: 'Dangerous', message: 'Delete everything?' },
      { sessionId: 'session-1' }
    );

    expect(interactionDispatcher.dispatchAndWait).toHaveBeenCalledWith(
      expect.any(String),
      'session-1',
      expect.objectContaining({ type: 'interaction_approval' }),
      null
    );
  });
});
