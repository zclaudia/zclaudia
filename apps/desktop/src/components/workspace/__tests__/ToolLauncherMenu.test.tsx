// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { usePluginStore } from '../../../stores/pluginStore';
import { ToolLauncherMenu } from '../ToolLauncherMenu';

beforeEach(() => {
  usePluginStore.setState({
    panels: [
      { id: 'terminal', pluginId: 'x', type: 'panel', label: 'Terminal' },
      { id: 'draft', pluginId: 'x', type: 'panel', label: 'Draft' },
    ] as any,
    disabledBuiltinPanels: [],
  });
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
});
