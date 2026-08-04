// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { usePluginStore } from '../../../stores/pluginStore';
import { useServerStore } from '../../../stores/serverStore';
import { ToolLauncherMenu } from '../ToolLauncherMenu';

beforeEach(() => {
  usePluginStore.setState({
    panels: [
      { id: 'terminal', pluginId: 'x', type: 'panel', label: 'Terminal' },
      { id: 'draft', pluginId: 'x', type: 'panel', label: 'Draft' },
    ] as any,
    disabledBuiltinPanels: [],
  });
  useServerStore.setState({ activeServerId: null, connections: {} } as any);
});

describe('ToolLauncherMenu', () => {
  it('renders each tool as a menu item with an icon and label', () => {
    const anchorRef = { current: document.createElement('div') };
    render(<ToolLauncherMenu sessionId="A" anchorRef={anchorRef} onPick={() => {}} />);

    const terminal = screen.getByRole('menuitem', { name: /Terminal/ });
    expect(terminal).toBeTruthy();
    expect(terminal.querySelector('svg')).toBeTruthy(); // icon rendered

    const draft = screen.getByRole('menuitem', { name: /Draft/ });
    expect(draft.querySelector('svg')).toBeTruthy();
  });

  it('omits panels flagged hideFromLauncher', () => {
    usePluginStore.setState({
      panels: [
        { id: 'terminal', pluginId: 'x', type: 'panel', label: 'Terminal' },
        {
          id: 'notifications',
          pluginId: 'x',
          type: 'panel',
          label: 'Notifications',
          hideFromLauncher: true,
        },
      ] as any,
      disabledBuiltinPanels: [],
    });
    const anchorRef = { current: document.createElement('div') };
    render(<ToolLauncherMenu sessionId="A" anchorRef={anchorRef} onPick={() => {}} />);

    expect(screen.getByRole('menuitem', { name: /Terminal/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Notifications/ })).toBeNull();
  });

  it('omits panels whose requiresFeature the active server does not advertise', () => {
    usePluginStore.setState({
      panels: [
        {
          id: 'terminal',
          pluginId: 'x',
          type: 'panel',
          label: 'Terminal',
          requiresFeature: 'remoteTerminal',
        },
        { id: 'draft', pluginId: 'x', type: 'panel', label: 'Draft' },
      ] as any,
      disabledBuiltinPanels: [],
    });
    const anchorRef = { current: document.createElement('div') };
    render(<ToolLauncherMenu sessionId="A" anchorRef={anchorRef} onPick={() => {}} />);

    expect(screen.queryByRole('menuitem', { name: /Terminal/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Draft/ })).toBeTruthy();
  });

  it('shows feature-gated panels when the active server advertises the feature', () => {
    usePluginStore.setState({
      panels: [
        {
          id: 'terminal',
          pluginId: 'x',
          type: 'panel',
          label: 'Terminal',
          requiresFeature: 'remoteTerminal',
        },
      ] as any,
      disabledBuiltinPanels: [],
    });
    useServerStore.setState({
      activeServerId: 's1',
      connections: { s1: { features: ['remoteTerminal'] } },
    } as any);
    const anchorRef = { current: document.createElement('div') };
    render(<ToolLauncherMenu sessionId="A" anchorRef={anchorRef} onPick={() => {}} />);

    expect(screen.getByRole('menuitem', { name: /Terminal/ })).toBeTruthy();
  });
});
