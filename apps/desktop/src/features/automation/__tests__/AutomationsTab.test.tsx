// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AutomationsTab } from '../AutomationsTab';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';

const api = {
  get: vi.fn().mockResolvedValue([
    {
      id: 'w1',
      name: 'Alpha',
      enabled: true,
      projectId: undefined,
      trigger: { type: 'manual' },
      action: { kind: 'activity', ref: 'git_commit' },
      createdAt: 0,
      updatedAt: 0,
    },
  ]),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
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

describe('Workflow action', () => {
  beforeEach(() => {
    useTopLevelViewStore.setState({ selectedAutomationItemId: null });
  });

  it('creates a workflow-action automation via the Workflow picker', async () => {
    const get = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith('/api/workflows')) {
        return [{ id: 'wf1', name: 'AI Auto Commit' }];
      }
      if (url.startsWith('/api/workflow-step-types')) {
        return {
          success: true,
          data: [
            {
              type: 'ai_prompt',
              name: 'AI Prompt',
              description: 'Run AI',
              category: 'AI',
              source: 'activity',
            },
          ],
        };
      }
      // /api/automations
      return [];
    });
    const post = vi.fn().mockResolvedValue({ id: 'created' });
    const wfApi = { get, post, patch: vi.fn(), del: vi.fn() } as any;

    render(<AutomationsTab api={wfApi} projectName={() => 'Global'} />);

    const newBtn = await screen.findByRole('button', { name: 'New' });
    fireEvent.click(newBtn);

    const nameInput = await screen.findByPlaceholderText('Automation name');
    fireEvent.change(nameInput, { target: { value: 'Auto commit' } });

    // Select the Workflow action type
    const actionSelect = await waitFor(() => {
      const buttons = screen
        .getAllByRole('button')
        .filter(b => b.getAttribute('aria-haspopup') === 'listbox');
      const found = buttons.find(b => b.textContent?.includes('AI Prompt'));
      if (!found) throw new Error('action select not ready');
      return found;
    });
    fireEvent.click(actionSelect);
    fireEvent.click(screen.getByRole('option', { name: 'Workflow' }));

    // Pick the workflow from its select
    const workflowSelect = await waitFor(() => {
      const buttons = screen
        .getAllByRole('button')
        .filter(b => b.getAttribute('aria-haspopup') === 'listbox');
      const found = buttons.find(
        b => b.textContent?.includes('AI Auto Commit') || b.textContent?.includes('Select workflow')
      );
      if (!found) throw new Error('workflow select not ready');
      return found;
    });
    fireEvent.click(workflowSelect);
    fireEvent.click(screen.getByRole('option', { name: 'AI Auto Commit' }));

    const createBtn = await screen.findByRole('button', { name: 'Create' });
    fireEvent.click(createBtn);

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/api/automations',
        expect.objectContaining({
          action: expect.objectContaining({ kind: 'workflow', ref: 'wf1' }),
        })
      )
    );
  });
});

describe('Catalog-driven activity actions', () => {
  beforeEach(() => {
    useTopLevelViewStore.setState({ selectedAutomationItemId: null });
  });

  it('lists catalog activities and posts their configSchema values as action.input', async () => {
    const get = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith('/api/workflows')) return [];
      if (url.startsWith('/api/workflow-step-types')) {
        return {
          success: true,
          data: [
            {
              type: 'git_commit',
              name: 'Git Commit',
              description: 'Stage and commit',
              category: 'Git',
              source: 'activity',
              configSchema: {
                type: 'object',
                properties: { message: { type: 'string', description: 'Commit message' } },
                required: ['message'],
              },
            },
            {
              type: 'condition',
              name: 'Condition',
              description: 'branch',
              category: 'Flow Control',
              source: 'builtin',
            },
          ],
        };
      }
      return []; // /api/automations
    });
    const post = vi.fn().mockResolvedValue({ id: 'created' });
    const catApi = { get, post, patch: vi.fn(), del: vi.fn() } as any;

    render(<AutomationsTab api={catApi} projectName={() => 'Global'} />);

    fireEvent.click(await screen.findByRole('button', { name: 'New' }));
    fireEvent.change(await screen.findByPlaceholderText('Automation name'), {
      target: { value: 'Commit it' },
    });

    // Open the action-type select and pick the catalog activity 'Git Commit'.
    // The action select is the second listbox button (after the trigger select).
    const actionSelect = await waitFor(() => {
      const buttons = screen
        .getAllByRole('button')
        .filter(b => b.getAttribute('aria-haspopup') === 'listbox');
      // Trigger select shows 'Interval'; action select is the other one
      const found = buttons.find(
        b =>
          !b.textContent?.includes('Interval') &&
          !b.textContent?.includes('Manual') &&
          !b.textContent?.includes('Cron') &&
          !b.textContent?.includes('Once') &&
          !b.textContent?.includes('Event')
      );
      if (!found) throw new Error('action select not ready');
      return found;
    });
    fireEvent.click(actionSelect);
    // 'Condition' must NOT be offered (Flow Control filtered out).
    expect(screen.queryByRole('option', { name: 'Condition' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'Git Commit' }));

    // The configSchema-driven field renders; fill it.
    fireEvent.change(await screen.findByLabelText('message'), { target: { value: 'feat: y' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0];
    expect(body.action).toEqual({
      kind: 'activity',
      ref: 'git_commit',
      input: { message: 'feat: y' },
    });
  });
});
