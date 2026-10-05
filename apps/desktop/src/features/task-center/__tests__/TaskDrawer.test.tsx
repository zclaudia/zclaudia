import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskDrawer } from '../TaskDrawer';
import type { BackgroundTask } from '../../../stores/backgroundTaskStore';

function makeTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: 'task-1',
    sessionId: 's1',
    toolUseId: 'tool-1',
    description: 'Survey the auth module',
    kind: 'subagent',
    agentType: 'explore',
    status: 'in_progress',
    startedAt: Date.now() - 65_000,
    ...overrides,
  };
}

describe('TaskDrawer', () => {
  it('shows the agent badge and description in the header', () => {
    render(<TaskDrawer task={makeTask()} detail={null} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Sub-agent detail' });
    expect(dialog).toHaveTextContent('explore');
    expect(dialog).toHaveTextContent('Survey the auth module');
  });

  it('falls back to a generic badge label without an agent type', () => {
    render(<TaskDrawer task={makeTask({ agentType: undefined })} detail={null} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('agent');
  });

  it('shows the live activity line only for a running task with activity', () => {
    const { rerender } = render(
      <TaskDrawer task={makeTask({ activity: 'Reading src/index.ts' })} detail={null} onClose={() => {}} />
    );
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('Reading src/index.ts')).toBeInTheDocument();

    rerender(
      <TaskDrawer
        task={makeTask({ status: 'completed', completedAt: Date.now(), activity: 'stale' })}
        detail={null}
        onClose={() => {}}
      />
    );
    expect(screen.queryByText('Activity')).not.toBeInTheDocument();
  });

  it('renders the prompt when the originating Task call supplied one', () => {
    render(
      <TaskDrawer task={makeTask()} detail={{ prompt: 'Map every call site of verifyToken' }} onClose={() => {}} />
    );
    expect(screen.getByText('Prompt')).toBeInTheDocument();
    expect(screen.getByText('Map every call site of verifyToken')).toBeInTheDocument();
  });

  it('labels the summary section Result for terminal tasks and prefers task.summary', () => {
    render(
      <TaskDrawer
        task={makeTask({ status: 'completed', completedAt: Date.now(), summary: 'Found 3 call sites.' })}
        detail={{ resultText: 'raw result' }}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.getByText('Found 3 call sites.')).toBeInTheDocument();
    expect(screen.queryByText('raw result')).not.toBeInTheDocument();
  });

  it('falls back to the Task call result text when the task has no summary', () => {
    render(
      <TaskDrawer
        task={makeTask({ status: 'completed', completedAt: Date.now() })}
        detail={{ resultText: 'Agent report body' }}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('Agent report body')).toBeInTheDocument();
  });

  it('offers Stop only when the host wires it, and reports clicks', () => {
    const onStop = vi.fn();
    const task = makeTask();
    const { rerender } = render(<TaskDrawer task={task} detail={null} onStop={onStop} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Stop'));
    expect(onStop).toHaveBeenCalledWith(task);

    rerender(<TaskDrawer task={task} detail={null} onClose={() => {}} />);
    expect(screen.queryByText('Stop')).not.toBeInTheDocument();
  });

  it('closes on Escape and on the header close button', () => {
    const onClose = vi.fn();
    render(<TaskDrawer task={makeTask()} detail={null} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Close sub-agent detail'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows settled usage in the footer and the output file chip', () => {
    render(
      <TaskDrawer
        task={makeTask({
          status: 'completed',
          completedAt: Date.now(),
          outputFile: '/tmp/agent-output.md',
          usage: { total_tokens: 12_400, tool_uses: 21, duration_ms: 98_000 },
        })}
        detail={null}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('1m 38s')).toBeInTheDocument();
    expect(screen.getByText('12k tokens')).toBeInTheDocument();
    expect(screen.getByText('21 tool calls')).toBeInTheDocument();
    expect(screen.getByText('agent-output.md')).toBeInTheDocument();
  });

  it('renders inner steps with tool names and argument summaries', () => {
    render(
      <TaskDrawer
        task={makeTask()}
        detail={null}
        steps={[
          { id: 'i1', toolName: 'Read', toolInput: { file_path: '/src/auth/login.ts' }, status: 'completed' },
          { id: 'i2', toolName: 'Grep', toolInput: { pattern: 'verifyToken' }, status: 'running' },
        ]}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('Steps · 2')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('login.ts')).toBeInTheDocument();
    expect(screen.getByText('Grep')).toBeInTheDocument();
  });

  it('omits the Steps section when the agent has no attributed steps', () => {
    render(<TaskDrawer task={makeTask()} detail={null} onClose={() => {}} />);
    expect(screen.queryByText(/Steps ·/)).not.toBeInTheDocument();
  });
});
