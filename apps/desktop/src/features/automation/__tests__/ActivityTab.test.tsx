// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivityTab } from '../ActivityTab';
import { makeBackend, makeScope } from './scopeTestUtils';

const apis = vi.hoisted(() => new Map<string, { get: ReturnType<typeof vi.fn> }>());
vi.mock('../useAutomationApi', () => ({
  createAutomationApi: (id: string) => apis.get(id) ?? { get: async () => [] },
}));

function installApi(backendId: string, stepTypes: unknown[]) {
  const api = { get: vi.fn().mockResolvedValue(stepTypes) };
  apis.set(backendId, api);
  return api;
}

const CATALOG = [
  {
    type: 'git_commit',
    name: 'Git Commit',
    description: 'Commit changes',
    category: 'Git',
    source: 'activity',
  },
  {
    type: 'ai_summarize',
    name: 'AI Summarize',
    description: 'Summarize',
    category: 'AI',
    source: 'activity',
    supportsLoop: true,
  },
  // Non-activity entries must be filtered out of the catalog.
  {
    type: 'shell',
    name: 'Shell Command',
    description: 'Run shell',
    category: 'Automation',
    source: 'builtin',
  },
  {
    type: 'my_plugin_step',
    name: 'Plugin Step',
    description: 'From a plugin',
    category: 'Plugin',
    source: 'plugin',
  },
];

beforeEach(() => apis.clear());

describe('ActivityTab', () => {
  it('fetches the step-type catalog and shows only source=activity entries', async () => {
    const api = installApi('b1', CATALOG);
    render(<ActivityTab scope={makeScope([makeBackend('b1')])} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/workflow-step-types');
    });
    // Activities are shown…
    expect(await screen.findByText('Git Commit')).toBeDefined();
    expect(screen.getByText('AI Summarize')).toBeDefined();
    // …builtin / plugin step types are not.
    expect(screen.queryByText('Shell Command')).toBeNull();
    expect(screen.queryByText('Plugin Step')).toBeNull();
    // Count reflects only the two activities.
    expect(screen.getByText('2 activities')).toBeDefined();
  });

  it('groups activities under their category headings', async () => {
    installApi('b1', CATALOG);
    render(<ActivityTab scope={makeScope([makeBackend('b1')])} />);
    // Category headings are sentence-case section labels; text stays as provided.
    expect(await screen.findByText('Git')).toBeDefined();
    expect(screen.getByText('AI')).toBeDefined();
  });

  it('shows an empty state when no activities are registered', async () => {
    installApi('b1', [
      { type: 'shell', name: 'Shell', description: '', category: 'Automation', source: 'builtin' },
    ]);
    render(<ActivityTab scope={makeScope([makeBackend('b1')])} />);
    expect(await screen.findByText('No activities registered')).toBeDefined();
  });

  it('groups by backend under "All" with several backends and isolates a failure', async () => {
    installApi('b1', CATALOG);
    apis.set('b2', { get: vi.fn().mockRejectedValue(new Error('HTTP 502')) });
    render(
      <ActivityTab scope={makeScope([makeBackend('b1', 'Local'), makeBackend('b2', 'Remote')])} />
    );
    expect(await screen.findByRole('heading', { name: 'Local' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Remote' })).toBeDefined();
    expect(screen.getByText('Git Commit')).toBeDefined();
    expect(screen.getByText(/Couldn't load from Remote/)).toBeDefined();
    // The count only includes what actually loaded.
    expect(screen.getByText('2 activities')).toBeDefined();
  });
});
