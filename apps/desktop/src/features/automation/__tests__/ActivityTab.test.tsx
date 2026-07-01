// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ActivityTab } from '../ActivityTab';

function makeApi(stepTypes: unknown[]) {
  return {
    get: vi.fn().mockResolvedValue(stepTypes),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue(undefined),
  };
}

const CATALOG = [
  { type: 'git_commit', name: 'Git Commit', description: 'Commit changes', category: 'Git', source: 'activity' },
  { type: 'ai_summarize', name: 'AI Summarize', description: 'Summarize', category: 'AI', source: 'activity', supportsLoop: true },
  // Non-activity entries must be filtered out of the catalog.
  { type: 'shell', name: 'Shell Command', description: 'Run shell', category: 'Automation', source: 'builtin' },
  { type: 'my_plugin_step', name: 'Plugin Step', description: 'From a plugin', category: 'Plugin', source: 'plugin' },
];

describe('ActivityTab', () => {
  it('fetches the step-type catalog and shows only source=activity entries', async () => {
    const api = makeApi(CATALOG);
    render(<ActivityTab api={api as never} />);

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
    const api = makeApi(CATALOG);
    render(<ActivityTab api={api as never} />);
    // Category headings (uppercased via CSS, text stays as provided).
    expect(await screen.findByText('Git')).toBeDefined();
    expect(screen.getByText('AI')).toBeDefined();
  });

  it('shows an empty state when no activities are registered', async () => {
    const api = makeApi([{ type: 'shell', name: 'Shell', description: '', category: 'Automation', source: 'builtin' }]);
    render(<ActivityTab api={api as never} />);
    expect(await screen.findByText('No activities registered')).toBeDefined();
  });
});
