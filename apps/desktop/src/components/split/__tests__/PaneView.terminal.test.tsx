import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PaneView } from '../PaneView';
import { useSplitLayoutStore } from '../../../stores/splitLayoutStore';
import { usePluginStore, type UIExtension } from '../../../stores/pluginStore';

// Record each render's projectId to verify per-scope isolation.
const mounted: Array<{ projectId?: string }> = [];

/** A fake terminal component that records the projectId it receives. */
function FakeTerminal({ projectId }: { projectId?: string }) {
  mounted.push({ projectId });
  return <div data-testid={`term-${projectId}`} />;
}

describe('PaneView terminal multi-scope', () => {
  beforeEach(() => {
    useSplitLayoutStore.setState({ root: null, focusedPaneId: null });
    mounted.length = 0;
  });
  afterEach(() => cleanup());

  it('two terminal panes with different scopes render different projectIds', () => {
    // Register a terminal panel whose component is FakeTerminal; PanelContent
    // passes projectId through, and PaneView decodes instanceKey → projectId.
    usePluginStore.setState({
      panels: [
        {
          id: 'terminal', pluginId: 'c', type: 'panel', label: 'Terminal', order: 0,
          component: FakeTerminal,
        } as unknown as UIExtension,
      ],
    });
    useSplitLayoutStore.setState({
      root: {
        id: 'g1', kind: 'group', dir: 'row', ratio: 0.5,
        children: [
          { id: 'p1', kind: 'pane', panelId: 'terminal', instanceKey: 'b1::projA' },
          { id: 'p2', kind: 'pane', panelId: 'terminal', instanceKey: 'b1::projB' },
        ],
      },
      focusedPaneId: 'p1',
    });
    render(
      <>
        <PaneView paneId="p1" focused projectId="default" projectRoot="/r" workingDirectory="/r" />
        <PaneView paneId="p2" focused={false} projectId="default" projectRoot="/r" workingDirectory="/r" />
      </>,
    );
    const ids = mounted.map((m) => m.projectId).sort();
    expect(ids).toEqual(['projA', 'projB']);
  });

  it('a terminal pane falls back to the context projectId when instanceKey is absent', () => {
    usePluginStore.setState({
      panels: [
        { id: 'terminal', pluginId: 'c', type: 'panel', label: 'Terminal', order: 0, component: FakeTerminal } as unknown as UIExtension,
      ],
    });
    useSplitLayoutStore.setState({
      root: { id: 'p1', kind: 'pane', panelId: 'terminal' },
      focusedPaneId: 'p1',
    });
    render(<PaneView paneId="p1" focused projectId="ctxProj" projectRoot="/r" workingDirectory="/r" />);
    expect(mounted[0].projectId).toBe('ctxProj');
  });
});
