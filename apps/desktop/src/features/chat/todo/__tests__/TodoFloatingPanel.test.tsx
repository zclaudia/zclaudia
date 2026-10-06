import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { MessageWithToolCalls } from '../../../../stores/chatMessageStore';
import type { ToolCallState } from '../../../../stores/runStore';
import { TodoFloatingPanel } from '../TodoFloatingPanel';
import { clampOffset } from '../todoSnapshot';

const requestMessageJump = vi.fn();
let isMobile = false;

vi.mock('../../../../stores/interactionStore', () => ({
  useInteractionStore: (selector: (s: unknown) => unknown) => selector({ interactions: {} }),
}));

vi.mock('../../../../stores/uiStore', () => ({
  useUIStore: (selector: (s: unknown) => unknown) => selector({ requestMessageJump }),
}));

vi.mock('../../../../hooks/useMediaQuery', () => ({
  useIsMobile: () => isMobile,
}));

const TODOS = [
  { content: 'Read the router', status: 'completed' },
  { content: 'Extract verifyToken', status: 'completed' },
  { content: 'Write unit tests', status: 'in_progress' },
  { content: 'Run full suite', status: 'pending' },
  { content: 'Migrate cookie', status: 'cancelled' },
];

function todoCall(todos: unknown = TODOS): ToolCallState {
  return { id: 't1', toolName: 'TodoWrite', toolInput: { todos }, status: 'completed' };
}

function assistant(toolCalls: ToolCallState[]): MessageWithToolCalls {
  return {
    id: 'm1',
    sessionId: 's1',
    role: 'assistant',
    content: '',
    createdAt: 0,
    toolCalls,
  } as MessageWithToolCalls;
}

function renderPanel(props: Partial<Parameters<typeof TodoFloatingPanel>[0]> = {}) {
  return render(
    <TodoFloatingPanel
      sessionId="s1"
      messages={[]}
      liveToolCalls={[todoCall()]}
      isRunning
      {...props}
    />
  );
}

describe('TodoFloatingPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    requestMessageJump.mockClear();
    isMobile = false;
  });

  it('renders nothing without a todo list', () => {
    renderPanel({ liveToolCalls: [] });
    expect(screen.queryByTestId('todo-floating-panel')).toBeNull();
  });

  it('shows progress and folds completed steps by default', () => {
    renderPanel();
    const panel = screen.getByTestId('todo-floating-panel');
    expect(panel).toHaveAttribute('data-state', 'expanded');
    expect(screen.getByText('3 of 5')).toBeInTheDocument();
    expect(screen.getByText('2 completed')).toBeInTheDocument();
    expect(screen.queryByText('Read the router')).toBeNull();
    expect(screen.getByText('Write unit tests').closest('li')).toHaveAttribute(
      'data-status',
      'in_progress'
    );
    expect(screen.getByText('Migrate cookie')).toBeInTheDocument();
  });

  it('reveals completed steps in their original order', () => {
    renderPanel();
    fireEvent.click(screen.getByText('2 completed'));
    const items = screen.getAllByRole('listitem').map(li => li.textContent);
    expect(items).toEqual(TODOS.map(t => t.content));
  });

  it('collapses to a pill showing the current step and remembers it', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse task list' }));
    const panel = screen.getByTestId('todo-floating-panel');
    expect(panel).toHaveAttribute('data-state', 'collapsed');
    expect(screen.getByText('Write unit tests')).toBeInTheDocument();
    expect(screen.getByText('3/5')).toBeInTheDocument();
    expect(localStorage.getItem('zclaudia:todo-panel:collapsed')).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: /Show task list, 3 of 5 done/ }));
    expect(screen.getByTestId('todo-floating-panel')).toHaveAttribute('data-state', 'expanded');
  });

  it('starts collapsed on mobile', () => {
    isMobile = true;
    renderPanel();
    expect(screen.getByTestId('todo-floating-panel')).toHaveAttribute('data-state', 'collapsed');
  });

  it('shows a done pill while the run is still going', () => {
    localStorage.setItem('zclaudia:todo-panel:collapsed', '1');
    renderPanel({ liveToolCalls: [todoCall([{ content: 'A', status: 'completed' }])] });
    expect(screen.getByText('All 1 tasks done')).toBeInTheDocument();
  });

  it('hides a finished list once the run ends', () => {
    renderPanel({
      isRunning: false,
      liveToolCalls: [todoCall([{ content: 'A', status: 'completed' }])],
    });
    expect(screen.queryByTestId('todo-floating-panel')).toBeNull();
  });

  it('keeps an unfinished list from the latest turn after the run ends', () => {
    renderPanel({ isRunning: false, liveToolCalls: [], messages: [assistant([todoCall()])] });
    expect(screen.getByTestId('todo-floating-panel')).toBeInTheDocument();
  });

  it('does not resurface an unfinished list from an earlier turn', () => {
    const user = { ...assistant([]), id: 'm2', role: 'user' } as MessageWithToolCalls;
    renderPanel({ isRunning: false, liveToolCalls: [], messages: [assistant([todoCall()]), user] });
    expect(screen.queryByTestId('todo-floating-panel')).toBeNull();
  });

  it('jumps to the message carrying the update', () => {
    renderPanel({ liveToolCalls: [], messages: [assistant([todoCall()])] });
    fireEvent.click(screen.getByRole('button', { name: 'Show in chat' }));
    expect(requestMessageJump).toHaveBeenCalledWith('s1', 'm1');
  });

  it('omits the jump link while the update only exists in the live run', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Show in chat' })).toBeNull();
  });

  describe('keeping the panel inside the chat pane', () => {
    const PANE = { clientWidth: 400, clientHeight: 300 };
    let panelHeight = 200;
    let observed: ResizeObserverCallback[] = [];
    const restore: Array<() => void> = [];

    function stub<K extends keyof HTMLElement>(key: K, get: (el: HTMLElement) => unknown) {
      const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
      Object.defineProperty(HTMLElement.prototype, key, {
        configurable: true,
        get(this: HTMLElement) {
          return get(this);
        },
      });
      restore.push(() => {
        if (original) Object.defineProperty(HTMLElement.prototype, key, original);
      });
    }

    beforeEach(() => {
      panelHeight = 200;
      observed = [];
      const pane = document.createElement('div');
      Object.defineProperties(pane, {
        clientWidth: { get: () => PANE.clientWidth },
        clientHeight: { get: () => PANE.clientHeight },
      });
      stub('offsetParent', el => (el.dataset.testid === 'todo-floating-panel' ? pane : null));
      stub('offsetHeight', el => (el.dataset.testid === 'todo-floating-panel' ? panelHeight : 0));
      stub('offsetWidth', el => (el.dataset.testid === 'todo-floating-panel' ? 288 : 0));
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(cb: ResizeObserverCallback) {
            observed.push(cb);
          }
          observe() {}
          disconnect() {}
          unobserve() {}
        }
      );
      return () => {
        restore.splice(0).forEach(fn => fn());
        vi.unstubAllGlobals();
      };
    });

    it('pulls a saved low position back up so the panel fits', () => {
      localStorage.setItem('zclaudia:todo-panel:offset', JSON.stringify({ top: 265, right: 12 }));
      renderPanel();
      // 300 pane - 200 panel - 8 edge
      expect(screen.getByTestId('todo-floating-panel').style.top).toBe('92px');
    });

    it('re-clamps when the panel grows, without forgetting the saved spot', () => {
      localStorage.setItem('zclaudia:todo-panel:offset', JSON.stringify({ top: 60, right: 12 }));
      renderPanel();
      const panel = screen.getByTestId('todo-floating-panel');
      expect(panel.style.top).toBe('60px');

      panelHeight = 260;
      act(() => observed.forEach(cb => cb([], {} as ResizeObserver)));
      expect(panel.style.top).toBe('32px');

      panelHeight = 200;
      act(() => observed.forEach(cb => cb([], {} as ResizeObserver)));
      expect(panel.style.top).toBe('60px');
      expect(localStorage.getItem('zclaudia:todo-panel:offset')).toBe(
        JSON.stringify({ top: 60, right: 12 })
      );
    });
  });
});

describe('clampOffset', () => {
  it('passes the offset through before anything is measured', () => {
    expect(clampOffset({ top: 500, right: 500 }, null)).toEqual({ top: 500, right: 500 });
  });

  it('keeps at least the edge margin even when the pane is too small', () => {
    expect(clampOffset({ top: 100, right: 100 }, { maxTop: -40, maxRight: 2 })).toEqual({
      top: 8,
      right: 8,
    });
  });
});
