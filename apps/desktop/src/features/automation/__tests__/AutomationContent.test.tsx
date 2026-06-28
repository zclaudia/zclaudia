// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/api/base', () => ({
  getBaseUrlForBackend: () => 'http://localhost:3100',
  getAuthHeadersForBackend: () => ({ Authorization: '' }),
}));

import { AutomationContent } from '../AutomationContent';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function ok(data: unknown) {
  return { ok: true, json: async () => ({ success: true, data }) };
}

describe('AutomationContent', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/projects')) return ok([{ id: 'p1', name: 'Project 1' }]);
      if (url.endsWith('/api/agent/config')) return ok({ permissionWorkflowOverrideId: null });
      if (url.includes('/api/automations')) {
        return ok([{
          id: 'w1',
          name: 'Build',
          status: 'active',
          authoringMode: 'simple',
          definition: {
            nodes: [{ id: 'n1', type: 'shell' }],
            edges: [],
            entryNodeId: 'n1',
            triggers: [{ type: 'interval', intervalMinutes: 60 }],
          },
        }]);
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
  });

  it('renders the automations tab body for the selected backend', async () => {
    render(<AutomationContent tab="automations" backendId="b1" />);
    await waitFor(() => {
      expect(screen.getByText('Build')).toBeTruthy();
    });
  });

  it('does not refetch automations on every render', async () => {
    render(<AutomationContent tab="automations" backendId="b1" />);
    await waitFor(() => {
      expect(screen.getByText('Build')).toBeTruthy();
    });
    const automationCalls = mockFetch.mock.calls.filter(
      ([input]) => String(input).includes('/api/automations') && !(input as RequestInit | undefined)?.method,
    );
    expect(automationCalls.length).toBeGreaterThanOrEqual(1);
    expect(automationCalls.length).toBeLessThanOrEqual(2);
  });

  it('sends onceAt when creating a one-time automation', async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/projects')) return ok([]);
      if (url.endsWith('/api/agent/config')) return ok({ permissionWorkflowOverrideId: null });
      if (url.includes('/api/automations') && init?.method === 'POST') return ok({ id: 'created' });
      if (url.includes('/api/automations')) return ok([]);
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<AutomationContent tab="automations" backendId="b1" />);

    const newBtn = await screen.findByRole('button', { name: 'New' });
    fireEvent.click(newBtn);

    const nameInput = await screen.findByPlaceholderText('Automation name');
    fireEvent.change(nameInput, { target: { value: 'One shot' } });

    const triggerSelect = await waitFor(() => {
      const buttons = screen.getAllByRole('button').filter(b => b.getAttribute('aria-haspopup') === 'listbox');
      const found = buttons.find(b => b.textContent?.includes('Interval'));
      if (!found) throw new Error('trigger select not ready');
      return found;
    });
    fireEvent.click(triggerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'Once' }));

    const onceInput = await waitFor(() => {
      const el = document.querySelector('input[type="datetime-local"]');
      if (!el) throw new Error('datetime input not ready');
      return el as HTMLInputElement;
    });
    fireEvent.change(onceInput, { target: { value: '2026-03-25T09:30' } });

    const createBtn = await screen.findByRole('button', { name: 'Create' });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/automations',
        expect.objectContaining({ method: 'POST', body: expect.any(String) }),
      );
    });

    const postCall = mockFetch.mock.calls.find((call) =>
      String(call[0]).endsWith('/api/automations') && (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    const payload = JSON.parse(String((postCall?.[1] as RequestInit).body));
    expect(payload.trigger.type).toBe('once');
    expect(typeof payload.trigger.onceAt).toBe('number');
    expect(Number.isFinite(payload.trigger.onceAt)).toBe(true);
  });
});
