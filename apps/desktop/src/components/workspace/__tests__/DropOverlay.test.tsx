import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DropOverlay } from '../DropOverlay';
import { useDragSplitStore } from '../dragSplit';

describe('DropOverlay', () => {
  beforeEach(() =>
    useDragSplitStore.setState({
      active: null,
      hoverPaneId: null,
      hoverZone: null,
      disabled: new Set(),
    })
  );
  afterEach(() => cleanup());

  it('renders nothing when no drag is active', () => {
    const { container } = render(<DropOverlay paneId="p1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the four edge zones + center when a drag is active', () => {
    useDragSplitStore.setState({ active: { toolId: 'memory' } });
    render(<DropOverlay paneId="p1" />);
    expect(screen.getAllByText('').length).toBeGreaterThanOrEqual(0); // smoke
    expect(document.querySelector('[data-zone="left"]')).not.toBeNull();
    expect(document.querySelector('[data-zone="right"]')).not.toBeNull();
    expect(document.querySelector('[data-zone="top"]')).not.toBeNull();
    expect(document.querySelector('[data-zone="bottom"]')).not.toBeNull();
    expect(document.querySelector('[data-zone="center"]')).not.toBeNull();
  });

  it('marks the hovered pane zone as active', () => {
    useDragSplitStore.setState({
      active: { toolId: 'memory' },
      hoverPaneId: 'p1',
      hoverZone: 'right',
      disabled: new Set(),
    });
    render(<DropOverlay paneId="p1" />);
    const rightZone = document.querySelector('[data-zone="right"]') as HTMLElement;
    expect(rightZone.getAttribute('data-active')).toBe('true');
    // Other zones are not active.
    const leftZone = document.querySelector('[data-zone="left"]') as HTMLElement;
    expect(leftZone.getAttribute('data-active')).toBe('false');
  });

  it('marks disabled zones (singleton conflict)', () => {
    useDragSplitStore.setState({
      active: { toolId: 'draft' },
      hoverPaneId: 'p1',
      hoverZone: 'right',
      disabled: new Set(['left', 'right', 'top', 'bottom']),
    });
    render(<DropOverlay paneId="p1" />);
    for (const z of ['left', 'right', 'top', 'bottom']) {
      const el = document.querySelector(`[data-zone="${z}"]`) as HTMLElement;
      expect(el.getAttribute('data-disabled')).toBe('true');
    }
  });

  it('only reflects hover for its own paneId', () => {
    useDragSplitStore.setState({
      active: { toolId: 'memory' },
      hoverPaneId: 'p2', // a different pane
      hoverZone: 'right',
      disabled: new Set(),
    });
    render(<DropOverlay paneId="p1" />);
    const rightZone = document.querySelector('[data-zone="right"]') as HTMLElement;
    expect(rightZone.getAttribute('data-active')).toBe('false'); // not this pane
  });
});
