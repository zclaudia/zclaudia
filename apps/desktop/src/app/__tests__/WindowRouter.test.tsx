import { StrictMode, Suspense, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePluginStore } from '../../stores/pluginStore';
import { WindowRouter } from '../WindowRouter';

// Keep the real route selection and builtin registrations, without mounting
// terminals, network connections, or the full standalone window contents.
vi.mock('../windows/WindowShell', () => ({
  WindowShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../features/chat/SessionChatWindow', () => ({
  SessionChatWindow: () => <div data-testid="session-host" />,
}));
vi.mock('../../features/dashboard/ProjectDashboardWindow', () => ({
  ProjectDashboardWindow: () => <div data-testid="dashboard-host" />,
}));
vi.mock('../../components/terminal/TerminalPanel', () => ({
  TerminalPanel: () => null,
  TerminalActions: () => null,
}));
vi.mock('../../components/fileviewer/FileViewerPanel', () => ({
  FileViewerPanel: () => null,
  FileViewerActions: () => null,
}));
vi.mock('../../components/draft/DraftPanel', () => ({ DraftPanel: () => null }));
vi.mock('../../components/draft/DraftActions', () => ({ DraftActions: () => null }));
vi.mock('../../components/notifications/NotificationsPanel', () => ({
  NotificationsPanel: () => null,
}));
vi.mock('../../features/changes/ChangesPanel', () => ({ ChangesPanel: () => null }));
vi.mock('../../features/memory/MemoryPanel', () => ({ MemoryPanel: () => null }));
vi.mock('../../features/lineage/LineagePanel', () => ({
  LineagePanel: () => null,
  LineageActions: () => null,
}));
vi.mock('../../features/git/components/GitSidebarPanel', () => ({ GitSidebarPanel: () => null }));
vi.mock('../../features/browser/BrowserPanel', () => ({ BrowserPanel: () => null }));

describe('WindowRouter builtin panel bootstrap', () => {
  beforeEach(() => {
    usePluginStore.setState({ panels: [] });
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => window.history.replaceState(null, '', '/'));

  it.each([
    ['', 'main-host'],
    ['?sessionWindow=chat-A&projectId=project', 'session-host'],
    ['?projectDashboard=project', 'dashboard-host'],
  ])('registers the actual tool catalog for host route %s', async (query, host) => {
    window.history.replaceState(null, '', `/${query}`);
    render(
      <Suspense>
        <WindowRouter>
          <div data-testid="main-host" />
        </WindowRouter>
      </Suspense>
    );
    await screen.findByTestId(host);
    const panels = usePluginStore.getState().panels;
    expect(panels.map(panel => panel.id)).toEqual([
      'terminal',
      'file-viewer',
      'draft',
      'session-changes',
      'memory',
      'notifications',
      'lineage',
      'git',
      'browser',
    ]);
    expect(panels.every(panel => panel.builtin && panel.component)).toBe(true);
  });

  it('preserves a live panel across strict effects and router remounts', () => {
    const { unmount } = render(
      <StrictMode>
        <WindowRouter>
          <div />
        </WindowRouter>
      </StrictMode>
    );
    usePluginStore.getState().updatePanelVisibility('memory', true);
    const panels = usePluginStore.getState().panels;
    unmount();
    render(
      <StrictMode>
        <WindowRouter>
          <div />
        </WindowRouter>
      </StrictMode>
    );
    expect(usePluginStore.getState().panels).toBe(panels);
    expect(panels.find(panel => panel.id === 'memory')?.visible).toBe(true);
  });
});
