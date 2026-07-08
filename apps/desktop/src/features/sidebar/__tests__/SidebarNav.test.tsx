// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SidebarNav } from '../SidebarNav';

describe('SidebarNav', () => {
  it('renders the Home item', () => {
    render(<SidebarNav onHome={vi.fn()} isHomeActive={false} />);
    expect(screen.getByRole('button', { name: 'Home' })).toBeDefined();
  });

  it('calls onHome when Home is clicked', () => {
    const onHome = vi.fn();
    render(<SidebarNav onHome={onHome} isHomeActive={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('marks Home active when isHomeActive is true', () => {
    render(<SidebarNav onHome={vi.fn()} isHomeActive={true} />);
    expect(screen.getByRole('button', { name: 'Home' }).className).not.toContain(
      'text-muted-foreground'
    );
  });

  it('does not mark Home active when isHomeActive is false', () => {
    render(<SidebarNav onHome={vi.fn()} isHomeActive={false} />);
    expect(screen.getByRole('button', { name: 'Home' }).className).toContain(
      'text-muted-foreground'
    );
  });

  it('renders Automations and fires its callback when provided', () => {
    const onOpenAutomations = vi.fn();
    render(
      <SidebarNav onHome={vi.fn()} isHomeActive={false} onOpenAutomations={onOpenAutomations} />
    );
    const automations = screen.getByRole('button', { name: 'Automations' });
    fireEvent.click(automations);
    expect(onOpenAutomations).toHaveBeenCalledTimes(1);
  });

  it('hides Automations when no callback is provided', () => {
    render(<SidebarNav onHome={vi.fn()} isHomeActive={false} />);
    expect(screen.queryByRole('button', { name: 'Automations' })).toBeNull();
  });

  const automationMode = {
    tab: 'automations' as const,
    onSelectTab: vi.fn(),
    onBack: vi.fn(),
  };

  it('renders the automation nav when automationMode is provided', () => {
    render(<SidebarNav onHome={vi.fn()} isHomeActive={false} automationMode={automationMode} />);
    expect(screen.getByRole('button', { name: 'Back to app' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Workflows' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Runs' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'System' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
  });

  it('fires onBack and onSelectTab from the automation nav', () => {
    const onBack = vi.fn();
    const onSelectTab = vi.fn();
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        automationMode={{ tab: 'automations', onBack, onSelectTab }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }));
    expect(onSelectTab).toHaveBeenCalledWith('runs');
  });

  it('marks the active automation tab', () => {
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        automationMode={{ tab: 'workflows', onBack: vi.fn(), onSelectTab: vi.fn() }}
      />
    );
    expect(screen.getByRole('button', { name: 'Workflows' }).className).not.toContain(
      'text-muted-foreground'
    );
    expect(screen.getByRole('button', { name: 'Runs' }).className).toContain(
      'text-muted-foreground'
    );
  });

  it('renders Agents entry and calls onOpenAgents', () => {
    const onOpenAgents = vi.fn();
    render(<SidebarNav onHome={vi.fn()} isHomeActive={false} onOpenAgents={onOpenAgents} />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    expect(onOpenAgents).toHaveBeenCalled();
  });

  it('does not render Agents entry when onOpenAgents is omitted', () => {
    render(<SidebarNav onHome={vi.fn()} isHomeActive={false} />);
    expect(screen.queryByRole('button', { name: 'Agents' })).toBeNull();
  });

  it('renders agents-mode tabs with back button', () => {
    const onBack = vi.fn();
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        agentsMode={{ tab: 'profiles', onSelectTab: vi.fn(), onBack }}
      />
    );
    expect(screen.getByRole('button', { name: 'Agent Profiles' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('fires onSelectTab with "profiles" when the Agent Profiles tab is clicked', () => {
    const onSelectTab = vi.fn();
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        agentsMode={{ tab: 'profiles', onSelectTab, onBack: vi.fn() }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Agent Profiles' }));
    expect(onSelectTab).toHaveBeenCalledWith('profiles');
  });

  it('marks the active agents tab', () => {
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        agentsMode={{ tab: 'profiles', onSelectTab: vi.fn(), onBack: vi.fn() }}
      />
    );
    expect(screen.getByRole('button', { name: 'Agent Profiles' }).className).toContain('bg-secondary');
  });

  it('fires onSelectTab with "skills" when the Skills tab is clicked', () => {
    const onSelectTab = vi.fn();
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        agentsMode={{ tab: 'profiles', onSelectTab, onBack: vi.fn() }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    expect(onSelectTab).toHaveBeenCalledWith('skills');
  });

  it('fires onSelectTab with "mcp-servers" when the MCP Servers tab is clicked', () => {
    const onSelectTab = vi.fn();
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        agentsMode={{ tab: 'profiles', onSelectTab, onBack: vi.fn() }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'MCP Servers' }));
    expect(onSelectTab).toHaveBeenCalledWith('mcp-servers');
  });

  it('renders Extensions entry and calls onOpenPlugins', () => {
    const onOpenPlugins = vi.fn();
    render(<SidebarNav onHome={vi.fn()} isHomeActive={false} onOpenPlugins={onOpenPlugins} />);
    fireEvent.click(screen.getByRole('button', { name: 'Extensions' }));
    expect(onOpenPlugins).toHaveBeenCalled();
  });

  it('does not render Extensions entry when onOpenPlugins is omitted', () => {
    render(<SidebarNav onHome={vi.fn()} isHomeActive={false} />);
    expect(screen.queryByRole('button', { name: 'Extensions' })).toBeNull();
  });

  it('renders plugins-mode tabs with back button', () => {
    const onBack = vi.fn();
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        pluginsMode={{ tab: 'built-in', onSelectTab: vi.fn(), onBack }}
      />
    );
    expect(screen.getByRole('button', { name: 'Built-in' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plugins' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Web Search' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('fires onSelectTab with "web-search" when the Web Search tab is clicked', () => {
    const onSelectTab = vi.fn();
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        pluginsMode={{ tab: 'plugins', onSelectTab, onBack: vi.fn() }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Web Search' }));
    expect(onSelectTab).toHaveBeenCalledWith('web-search');
  });

  it('marks the active plugins tab', () => {
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        pluginsMode={{ tab: 'plugins', onSelectTab: vi.fn(), onBack: vi.fn() }}
      />
    );
    expect(screen.getByRole('button', { name: 'Plugins' }).className).toContain('bg-secondary');
  });

  it('fires onSelectTab with "providers" when the LLM Providers tab is clicked', () => {
    const onSelectTab = vi.fn();
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        agentsMode={{ tab: 'profiles', onSelectTab, onBack: vi.fn() }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'LLM Providers' }));
    expect(onSelectTab).toHaveBeenCalledWith('providers');
  });

  it('marks the LLM Providers tab active when on the providers tab', () => {
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        agentsMode={{ tab: 'providers', onSelectTab: vi.fn(), onBack: vi.fn() }}
      />
    );
    expect(screen.getByRole('button', { name: 'LLM Providers' }).className).toContain('bg-secondary');
    expect(screen.getByRole('button', { name: 'Agent Profiles' }).className).toContain(
      'text-muted-foreground'
    );
  });

  it('marks the MCP Servers tab active when on the mcp-servers tab', () => {
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        agentsMode={{ tab: 'mcp-servers', onSelectTab: vi.fn(), onBack: vi.fn() }}
      />
    );
    expect(screen.getByRole('button', { name: 'MCP Servers' }).className).toContain('bg-secondary');
    expect(screen.getByRole('button', { name: 'Agent Profiles' }).className).toContain(
      'text-muted-foreground'
    );
  });

  it('marks the Skills tab active and Agent Profiles inactive when on the skills tab', () => {
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        agentsMode={{ tab: 'skills', onSelectTab: vi.fn(), onBack: vi.fn() }}
      />
    );
    expect(screen.getByRole('button', { name: 'Skills' }).className).toContain('bg-secondary');
    expect(screen.getByRole('button', { name: 'Agent Profiles' }).className).toContain(
      'text-muted-foreground'
    );
  });
});

const base = { onHome: () => {}, isHomeActive: false };

describe('SidebarNav automation mode', () => {
  it('renders the automation tab rows with visible labels', () => {
    render(
      <SidebarNav
        {...base}
        automationMode={{ tab: 'workflows', onSelectTab: () => {}, onBack: () => {} }}
      />
    );
    for (const name of ['Automations', 'Activity', 'Workflows', 'Runs', 'System']) {
      expect(screen.getByRole('button', { name })).toHaveTextContent(name);
    }
  });

  it('fires onSelectTab with "activity" when the Activity row is clicked', () => {
    const onSelectTab = vi.fn();
    render(
      <SidebarNav
        {...base}
        automationMode={{ tab: 'automations', onSelectTab, onBack: () => {} }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(onSelectTab).toHaveBeenCalledWith('activity');
  });

  it('calls onSelectTab when a row is clicked', () => {
    const onSelectTab = vi.fn();
    render(
      <SidebarNav {...base} automationMode={{ tab: 'workflows', onSelectTab, onBack: () => {} }} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }));
    expect(onSelectTab).toHaveBeenCalledWith('runs');
  });
});
