// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AutomationsTab } from '../AutomationsTab';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';

const api = {
  get: vi.fn().mockResolvedValue([
    { id: 'w1', name: 'Alpha', status: 'active', projectId: undefined,
      definition: { triggers: [{ type: 'manual' }], nodes: [] } },
  ]),
  post: vi.fn(), patch: vi.fn(), del: vi.fn(),
} as any;

beforeEach(() => {
  useTopLevelViewStore.setState({ selectedAutomationItemId: 'w1' });
});

it('highlights the card matching selectedAutomationItemId', async () => {
  render(<AutomationsTab api={api} projectName={() => 'Global'} />);
  const name = await screen.findByText('Alpha');
  const card = name.closest('[data-automation-card]');
  expect(card).toHaveClass('ring-2');
});
