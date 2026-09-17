// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/api/base', () => ({
  getBaseUrlForBackend: (id: string) => `http://${id}.local`,
  getAuthHeadersForBackend: () => ({ Authorization: '' }),
}));

vi.mock('../AutomationWorkflowDetail', () => ({
  AutomationWorkflowDetail: () => <div data-testid="wf-detail" />,
}));
vi.mock('../RunsTab', () => ({ RunsTab: () => <div data-testid="runs-tab" /> }));

import { AutomationContent } from '../AutomationContent';
import { useFacadeStore } from '../../../stores/facadeStore';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function ok(data: unknown) {
  return { ok: true, json: async () => ({ success: true, data }) };
}

function backend(backendId: string, name: string, online = true) {
  return { backendId, name, online, isThisInstance: backendId === 'b1' } as never;
}

function setBackends(list: unknown[]) {
  useFacadeStore.setState({ backends: list as never, localBackendId: 'b1' });
}

const automation = (id: string, name: string) => ({
  id,
  name,
  enabled: true,
  projectId: 'p1',
  trigger: { type: 'interval', intervalMinutes: 60 },
  action: { kind: 'activity', ref: 'shell', input: {} },
  createdAt: 0,
  updatedAt: 0,
});

describe('AutomationContent', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  beforeEach(() => {
    useTopLevelViewStore.setState({
      view: { kind: 'automations', tab: 'automations' },
      automationBackendFilter: 'all',
      selectedAutomationItemId: null,
      selectedAutomationItemBackendId: null,
    });
    setBackends([backend('b1', 'Local')]);
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/projects')) return ok([{ id: 'p1', name: 'Project 1' }]);
      if (url.endsWith('/api/workflows')) return ok([]);
      if (url.endsWith('/api/workflow-step-types')) return ok([]);
      if (url.includes('/api/automations')) {
        return ok([
          automation(
            url.startsWith('http://b2') ? 'w2' : 'w1',
            url.startsWith('http://b2') ? 'Deploy' : 'Build'
          ),
        ]);
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
  });

  it('renders the automations of the online backend', async () => {
    render(<AutomationContent tab="automations" />);
    await waitFor(() => {
      expect(screen.getByText('Build')).toBeTruthy();
    });
    // A single backend needs no chip row.
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull();
  });

  it('fetches every online backend and narrows through the Backend chips', async () => {
    setBackends([backend('b1', 'Local'), backend('b2', 'Remote'), backend('b3', 'Off', false)]);
    render(<AutomationContent tab="automations" />);
    await waitFor(() => {
      expect(screen.getByText('Build')).toBeTruthy();
      expect(screen.getByText('Deploy')).toBeTruthy();
    });
    const hosts = mockFetch.mock.calls
      .map(([input]) => new URL(String(input)).host)
      .filter((h, i, all) => all.indexOf(h) === i)
      .sort();
    // Offline backends are never fetched.
    expect(hosts).toEqual(['b1.local', 'b2.local']);

    fireEvent.click(screen.getByRole('button', { name: /Remote/ }));
    await waitFor(() => {
      expect(screen.queryByText('Build')).toBeNull();
      expect(screen.getByText('Deploy')).toBeTruthy();
    });
    expect(useTopLevelViewStore.getState().automationBackendFilter).toBe('b2');
  });

  it('does not refetch automations when re-rendered with the same props', async () => {
    const { rerender } = render(<AutomationContent tab="automations" />);
    await waitFor(() => {
      expect(screen.getByText('Build')).toBeTruthy();
    });
    const count = () =>
      mockFetch.mock.calls.filter(
        ([input, init]) =>
          String(input).includes('/api/automations') && !(init as RequestInit | undefined)?.method
      ).length;
    const countAfterLoad = count();

    rerender(<AutomationContent tab="automations" />);
    await new Promise(r => setTimeout(r, 0));
    expect(count()).toBe(countAfterLoad);
  });

  it('shows an empty state and fetches nothing when no backend is online', async () => {
    setBackends([backend('b1', 'Local', false)]);
    render(<AutomationContent tab="automations" />);
    expect(screen.getByRole('heading', { name: 'Automations' })).toBeTruthy();
    expect(screen.getByText('No backends online')).toBeTruthy();
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends onceAt when creating a one-time automation', async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/projects')) return ok([]);
      if (url.endsWith('/api/workflows')) return ok([]);
      if (url.endsWith('/api/workflow-step-types')) return ok([]);
      if (url.includes('/api/automations') && init?.method === 'POST') return ok({ id: 'created' });
      if (url.includes('/api/automations')) return ok([]);
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<AutomationContent tab="automations" />);

    fireEvent.click(await screen.findByRole('button', { name: 'New' }));
    fireEvent.change(await screen.findByPlaceholderText('Automation name'), {
      target: { value: 'One shot' },
    });

    const triggerSelect = await waitFor(() => {
      const buttons = screen
        .getAllByRole('button')
        .filter(b => b.getAttribute('aria-haspopup') === 'listbox');
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

    fireEvent.click(await screen.findByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://b1.local/api/automations',
        expect.objectContaining({ method: 'POST', body: expect.any(String) })
      );
    });

    const postCall = mockFetch.mock.calls.find(
      call =>
        String(call[0]).endsWith('/api/automations') &&
        (call[1] as RequestInit | undefined)?.method === 'POST'
    );
    const payload = JSON.parse(String((postCall?.[1] as RequestInit).body));
    expect(payload.trigger.type).toBe('once');
    expect(typeof payload.trigger.onceAt).toBe('number');
    expect(Number.isFinite(payload.trigger.onceAt)).toBe(true);
  });

  it('renders AutomationWorkflowDetail for the workflows tab', async () => {
    render(<AutomationContent tab="workflows" />);
    await waitFor(() => {
      expect(screen.getByTestId('wf-detail')).toBeTruthy();
    });
    expect(screen.queryByTestId('runs-tab')).toBeNull();
  });

  it('renders RunsTab for the runs tab', async () => {
    render(<AutomationContent tab="runs" />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-tab')).toBeTruthy();
    });
    expect(screen.queryByTestId('wf-detail')).toBeNull();
  });
});
