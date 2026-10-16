import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BackendRow } from '../BackendRow';

describe('BackendRow', () => {
  it('renders the backend name and online status', () => {
    render(
      <BackendRow name="Local Server" online expanded={false} onToggle={() => {}}>
        <div data-testid="child">projects</div>
      </BackendRow>
    );
    expect(screen.getByText('Local Server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Local Server/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('hides children when collapsed and shows them when expanded', () => {
    const { rerender } = render(
      <BackendRow name="Local Server" online expanded={false} onToggle={() => {}}>
        <div data-testid="child">projects</div>
      </BackendRow>
    );
    expect(screen.queryByTestId('child')).toBeNull();

    rerender(
      <BackendRow name="Local Server" online expanded onToggle={() => {}}>
        <div data-testid="child">projects</div>
      </BackendRow>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('calls onToggle when the header is clicked', () => {
    const onToggle = vi.fn();
    render(
      <BackendRow name="Local Server" online expanded={false} onToggle={onToggle}>
        <div />
      </BackendRow>
    );
    fireEvent.click(screen.getByRole('button', { name: /Local Server/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows the project count only while collapsed', () => {
    const { rerender } = render(
      <BackendRow name="Local Server" online expanded={false} onToggle={() => {}} projectCount={3}>
        <div />
      </BackendRow>
    );
    expect(screen.getByLabelText('3 projects')).toHaveTextContent('3');

    rerender(
      <BackendRow name="Local Server" online expanded onToggle={() => {}} projectCount={3}>
        <div />
      </BackendRow>
    );
    expect(screen.queryByLabelText('3 projects')).toBeNull();
  });

  it('omits the count when unknown or zero', () => {
    const { rerender } = render(
      <BackendRow name="Local Server" online expanded={false} onToggle={() => {}}>
        <div />
      </BackendRow>
    );
    expect(screen.queryByLabelText(/projects?$/)).toBeNull();

    rerender(
      <BackendRow name="Local Server" online expanded={false} onToggle={() => {}} projectCount={0}>
        <div />
      </BackendRow>
    );
    expect(screen.queryByLabelText(/projects?$/)).toBeNull();
  });

  it('has no trailing chevron beside the + button', () => {
    const { container } = render(
      <BackendRow name="Local Server" online expanded onToggle={() => {}} onNewProject={() => {}}>
        <div />
      </BackendRow>
    );
    expect(screen.getByRole('button', { name: /Local Server/ }).querySelector('svg')).toBeNull();
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });

  it('calls onNewProject when the + button is clicked', () => {
    const onNewProject = vi.fn();
    render(
      <BackendRow
        name="Local Server"
        online
        expanded={false}
        onToggle={() => {}}
        onNewProject={onNewProject}
      >
        <div />
      </BackendRow>
    );
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    expect(onNewProject).toHaveBeenCalledTimes(1);
  });

  it('shows a switch prompt instead of projects for a non-active backend', () => {
    const onActivate = vi.fn();
    render(
      <BackendRow
        name="Studio Mac"
        online
        expanded
        isActive={false}
        onActivate={onActivate}
        onToggle={() => {}}
      >
        <div data-testid="child">projects</div>
      </BackendRow>
    );
    // Only the active backend's projects are loaded, so the stale/empty list
    // must not be shown as if it were that backend's real contents.
    expect(screen.queryByTestId('child')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Switch to this backend/ }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('renders projects for the active backend', () => {
    render(
      <BackendRow
        name="Local Server"
        online
        expanded
        isActive
        onActivate={() => {}}
        onToggle={() => {}}
      >
        <div data-testid="child">projects</div>
      </BackendRow>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch to this backend/ })).toBeNull();
  });

  it('surfaces the connection state instead of a bare online dot', () => {
    const { rerender } = render(
      <BackendRow
        name="Local Server"
        online
        expanded={false}
        viewState="data_syncing"
        onToggle={() => {}}
      >
        <div />
      </BackendRow>
    );
    expect(screen.getByText('Syncing')).toBeInTheDocument();

    rerender(
      <BackendRow
        name="Local Server"
        online
        expanded={false}
        viewState="ready"
        latencyMs={42}
        onToggle={() => {}}
      >
        <div />
      </BackendRow>
    );
    expect(screen.queryByText('Syncing')).toBeNull();
    expect(screen.getByText('42ms')).toBeInTheDocument();
  });
});
