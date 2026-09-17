// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AutomationsTab } from '../AutomationsTab';
import { makeBackend, makeScope } from './scopeTestUtils';

const apis = vi.hoisted(() => new Map<string, any>());
vi.mock('../useAutomationApi', () => ({
  createAutomationApi: (id: string) => apis.get(id) ?? { get: async () => [] },
}));

const ALPHA = {
  id: 'w1',
  name: 'Alpha',
  enabled: true,
  projectId: undefined,
  trigger: { type: 'manual' },
  action: { kind: 'activity', ref: 'git_commit' },
  createdAt: 0,
  updatedAt: 0,
};

function installApi(backendId: string, get: (url: string) => Promise<unknown>) {
  const api = {
    get: vi.fn().mockImplementation(get),
    post: vi.fn().mockResolvedValue({ id: 'created' }),
    patch: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue(undefined),
  };
  apis.set(backendId, api);
  return api;
}

beforeEach(() => apis.clear());

async function listboxButton(match: (text: string) => boolean) {
  return waitFor(() => {
    const buttons = screen
      .getAllByRole('button')
      .filter(b => b.getAttribute('aria-haspopup') === 'listbox');
    const found = buttons.find(b => match(b.textContent ?? ''));
    if (!found) throw new Error('select not ready');
    return found;
  });
}

describe('AutomationsTab list', () => {
  it('lists automations and acts on them through their own backend', async () => {
    const api = installApi('b1', async url => (url.startsWith('/api/automations') ? [ALPHA] : []));
    render(<AutomationsTab scope={makeScope([makeBackend('b1')])} />);
    expect(await screen.findByText('Alpha')).toBeDefined();
    expect(screen.getByText('1 automation')).toBeDefined();
    expect(screen.getByText('Active (1)')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/automations/w1', { enabled: false })
    );
  });

  it('groups by backend under "All" and keeps disabled rows dimmed', async () => {
    installApi('b1', async url => (url.startsWith('/api/automations') ? [ALPHA] : []));
    installApi('b2', async url =>
      url.startsWith('/api/automations')
        ? [{ ...ALPHA, id: 'w2', name: 'Beta', enabled: false }]
        : []
    );
    render(
      <AutomationsTab
        scope={makeScope([makeBackend('b1', 'Local'), makeBackend('b2', 'Remote')])}
      />
    );
    expect(await screen.findByText('Alpha')).toBeDefined();
    expect(screen.getByText('Beta')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Local' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Remote' })).toBeDefined();
    expect(screen.getByText('2 automations')).toBeDefined();
    // Backend headers replace the Active / Disabled sections.
    expect(screen.queryByText('Active (1)')).toBeNull();
  });
});

describe('Workflow action', () => {
  it('creates a workflow-action automation via the Workflow picker', async () => {
    const api = installApi('b1', async url => {
      if (url.startsWith('/api/workflows')) return [{ id: 'wf1', name: 'AI Auto Commit' }];
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
      return []; // /api/automations
    });

    render(<AutomationsTab scope={makeScope([makeBackend('b1')])} />);

    fireEvent.click(await screen.findByRole('button', { name: 'New' }));
    fireEvent.change(await screen.findByPlaceholderText('Automation name'), {
      target: { value: 'Auto commit' },
    });

    fireEvent.click(await listboxButton(t => t.includes('AI Prompt')));
    fireEvent.click(screen.getByRole('option', { name: 'Workflow' }));

    fireEvent.click(
      await listboxButton(t => t.includes('AI Auto Commit') || t.includes('Select workflow'))
    );
    fireEvent.click(screen.getByRole('option', { name: 'AI Auto Commit' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/api/automations',
        expect.objectContaining({
          action: expect.objectContaining({ kind: 'workflow', ref: 'wf1' }),
        })
      )
    );
  });

  it('creates on the backend picked in the form when several are in scope', async () => {
    const stepTypes = [
      { type: 'ai_prompt', name: 'AI Prompt', description: '', category: 'AI', source: 'activity' },
    ];
    const local = installApi('b1', async url =>
      url.startsWith('/api/workflow-step-types') ? stepTypes : []
    );
    const remote = installApi('b2', async url =>
      url.startsWith('/api/workflow-step-types') ? stepTypes : []
    );
    render(
      <AutomationsTab
        scope={makeScope([makeBackend('b1', 'Local'), makeBackend('b2', 'Remote')])}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'New' }));
    fireEvent.click(await listboxButton(t => t.includes('Local')));
    fireEvent.click(screen.getByRole('option', { name: 'Remote' }));
    fireEvent.change(await screen.findByPlaceholderText('Automation name'), {
      target: { value: 'Remote job' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Create' }));

    await waitFor(() => expect(remote.post).toHaveBeenCalled());
    expect(local.post).not.toHaveBeenCalled();
  });
});

describe('Catalog-driven activity actions', () => {
  it('lists catalog activities and posts their configSchema values as action.input', async () => {
    const api = installApi('b1', async url => {
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

    render(<AutomationsTab scope={makeScope([makeBackend('b1')])} />);

    fireEvent.click(await screen.findByRole('button', { name: 'New' }));
    fireEvent.change(await screen.findByPlaceholderText('Automation name'), {
      target: { value: 'Commit it' },
    });

    // The action select is the listbox that is not the trigger select.
    fireEvent.click(
      await listboxButton(
        t => !['Interval', 'Manual', 'Cron', 'Once', 'Event'].some(x => t.includes(x))
      )
    );
    // 'Condition' must NOT be offered (Flow Control filtered out).
    expect(screen.queryByRole('option', { name: 'Condition' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'Git Commit' }));

    // The configSchema-driven field renders; fill it.
    fireEvent.change(await screen.findByLabelText('message'), { target: { value: 'feat: y' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = api.post.mock.calls[0];
    expect(body.action).toEqual({
      kind: 'activity',
      ref: 'git_commit',
      input: { message: 'feat: y' },
    });
  });
});

describe('Failure feedback', () => {
  it('shows a load error with retry instead of the empty state when the list request fails', async () => {
    const api = installApi('b1', async () => {
      throw new Error('HTTP 503');
    });
    render(<AutomationsTab scope={makeScope([makeBackend('b1', 'Local')])} />);
    expect(await screen.findByText(/Couldn't load from Local: HTTP 503/)).toBeInTheDocument();
    expect(screen.queryByText('No automations yet')).toBeNull();
    // The count line must not read "0 automations" while nothing has loaded —
    // a stale zero still reads as "the backend has no data".
    expect(screen.queryByText(/0 automations?/)).toBeNull();

    api.get.mockImplementation(async (url: string) =>
      url.startsWith('/api/automations') ? [ALPHA] : []
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('1 automation')).toBeInTheDocument();
  });

  it('shows an action error instead of failing silently when disable is rejected', async () => {
    const api = installApi('b1', async url => (url.startsWith('/api/automations') ? [ALPHA] : []));
    api.patch.mockRejectedValue(new Error('HTTP 409'));
    render(<AutomationsTab scope={makeScope([makeBackend('b1')])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disable' }));
    expect(await screen.findByText(/Failed to disable "Alpha": HTTP 409/)).toBeInTheDocument();
    // The failed item must still be listed as enabled.
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(screen.queryByText(/Failed to disable/)).toBeNull();
  });
});

describe('System automations', () => {
  it('renders system items read-only instead of offering Run/Disable/Delete', async () => {
    installApi('b1', async url =>
      url.startsWith('/api/automations')
        ? [
            {
              id: 'sys1',
              name: 'Permission Escalation (System)',
              enabled: true,
              isSystem: true,
              trigger: { type: 'event', event: 'permission.escalated' },
              action: { kind: 'workflow', ref: 'wf1' },
            },
            { ...ALPHA, id: 'usr1', name: 'Mine' },
          ]
        : []
    );
    render(<AutomationsTab scope={makeScope([makeBackend('b1')])} />);
    await screen.findByText('Permission Escalation (System)');
    const sysCard = screen
      .getByText('Permission Escalation (System)')
      .closest('[data-automation-card]');
    expect(sysCard?.textContent).toContain('System');
    expect(sysCard?.querySelector('button[aria-label="Run now"]')).toBeNull();
    expect(sysCard?.querySelector('button[aria-label="Disable"]')).toBeNull();
    expect(sysCard?.querySelector('button[aria-label="Delete"]')).toBeNull();
    const userCard = screen.getByText('Mine').closest('[data-automation-card]');
    expect(userCard?.querySelector('button[aria-label="Run now"]')).not.toBeNull();
  });
});

describe('Interval validation', () => {
  it('rejects a zero interval instead of silently saving 60', async () => {
    const api = installApi('b1', async url => {
      if (url.startsWith('/api/workflow-step-types')) return { success: true, data: [] };
      return [];
    });
    render(<AutomationsTab scope={makeScope([makeBackend('b1')])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New' }));
    fireEvent.change(await screen.findByPlaceholderText('Automation name'), {
      target: { value: 'Zero interval' },
    });
    fireEvent.change(await screen.findByPlaceholderText('60'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(
      await screen.findByText('Interval must be a positive whole number of minutes')
    ).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('Scope switches (E2E R01/C01)', () => {
  it('refetches when the project scope changes, without a manual refresh', async () => {
    const api = installApi('b1', async url =>
      url.startsWith('/api/automations') ? [ALPHA] : []
    );
    const { rerender } = render(
      <AutomationsTab scope={makeScope([makeBackend('b1')], { projectId: 'p1' })} />
    );
    await screen.findByText('Alpha');
    expect(api.get).toHaveBeenCalledWith('/api/automations?projectId=p1');

    rerender(<AutomationsTab scope={makeScope([makeBackend('b1')], { projectId: 'p2' })} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/automations?projectId=p2'));
  });

  it('names the submit scope inside the create form', async () => {
    installApi('b1', async url => (url.startsWith('/api/automations') ? [ALPHA] : []));
    render(
      <AutomationsTab
        scope={makeScope([makeBackend('b1')], {
          projectId: 'p1',
          projects: new Map([['b1', [{ id: 'p1', name: 'P1' }]]]),
        })}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'New' }));
    expect(await screen.findByText(/Saving to b1 · P1/)).toBeInTheDocument();
  });

  it('clears a draft when the project scope changes instead of re-targeting it', async () => {
    installApi('b1', async url => (url.startsWith('/api/automations') ? [ALPHA] : []));
    const { rerender } = render(
      <AutomationsTab scope={makeScope([makeBackend('b1')], { projectId: 'p1' })} />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'New' }));
    fireEvent.change(await screen.findByPlaceholderText('Automation name'), {
      target: { value: 'Typed in P1' },
    });

    rerender(<AutomationsTab scope={makeScope([makeBackend('b1')], { projectId: 'p2' })} />);
    // Remounted form: the name field is empty again, so nothing typed under P1
    // can be submitted into P2.
    expect(await screen.findByPlaceholderText('Automation name')).toHaveValue('');
  });
});

describe('Row action feedback (E2E R05)', () => {
  it('ignores a second Run now click while the first is still in flight', async () => {
    const api = installApi('b1', async url =>
      url.startsWith('/api/automations') ? [ALPHA] : []
    );
    let resolveRun: (() => void) | undefined;
    api.post.mockImplementation(
      () => new Promise(resolve => (resolveRun = () => resolve({})))
    );
    render(<AutomationsTab scope={makeScope([makeBackend('b1')])} />);
    const run = await screen.findByRole('button', { name: 'Run now' });

    fireEvent.click(run);
    expect(run).toBeDisabled();
    fireEvent.click(run);
    expect(api.post).toHaveBeenCalledTimes(1);

    resolveRun?.();
    await waitFor(() => expect(run).not.toBeDisabled());
  });
});

describe('Long names (E2E R03)', () => {
  it('unfolds the full name on tap and folds it back', async () => {
    const long = `${'长'.repeat(60)}甲`;
    installApi('b1', async url =>
      url.startsWith('/api/automations') ? [{ ...ALPHA, name: long }] : []
    );
    render(<AutomationsTab scope={makeScope([makeBackend('b1')])} />);
    const name = await screen.findByRole('button', { name: long });
    expect(name.getAttribute('aria-expanded')).toBe('false');
    expect(name.parentElement?.className).toContain('truncate');

    fireEvent.click(name);
    expect(name.getAttribute('aria-expanded')).toBe('true');
    expect(name.parentElement?.className).toContain('whitespace-normal');

    fireEvent.click(name);
    expect(name.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Create form catalog failures (E2E R06)', () => {
  const stepTypes = [
    { type: 'ai_prompt', name: 'AI Prompt', description: '', category: 'AI', source: 'activity' },
  ];

  it('explains the failure, blocks create, and recovers on retry', async () => {
    const api = installApi('b1', async url => {
      if (url.startsWith('/api/workflow-step-types')) throw new Error('HTTP 503');
      return [];
    });
    render(<AutomationsTab scope={makeScope([makeBackend('b1')])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New' }));
    expect(await screen.findByText(/Couldn't load the action types catalog/)).toBeInTheDocument();

    // An action picked while the catalog was down must not reach the API.
    fireEvent.change(await screen.findByPlaceholderText('Automation name'), {
      target: { value: 'Blocked' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(
      await screen.findByText(/action catalog didn't load/)
    ).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    api.get.mockImplementation(async (url: string) =>
      url.startsWith('/api/workflow-step-types') ? { success: true, data: stepTypes } : []
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.queryByText(/Couldn't load the action types catalog/)).toBeNull()
    );
  });
});
