// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Workflow } from '@zclaudia/shared';
import { WorkflowMobileView } from '../WorkflowMobileView';

function workflow(over: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf-1',
    name: 'Nightly Test & Fix',
    description: 'Run tests nightly',
    status: 'active',
    definition: {
      entryNodeId: 'run',
      nodes: [
        {
          id: 'run',
          name: 'Run Tests',
          type: 'shell',
          config: { command: 'pnpm test' },
          position: { x: 0, y: 0 },
          onError: 'route',
        },
        {
          id: 'fix',
          name: 'AI Fix Test Failures',
          type: 'ai_prompt',
          config: {},
          position: { x: 0, y: 0 },
        },
      ],
      edges: [{ id: 'e1', source: 'run', target: 'fix', type: 'error' }],
    },
    ...over,
  } as unknown as Workflow;
}

describe('WorkflowMobileView', () => {
  it('lists the steps and labels how a branch was reached', () => {
    render(<WorkflowMobileView workflow={workflow()} onBack={vi.fn()} />);
    expect(screen.getByText('Run Tests')).toBeInTheDocument();
    expect(screen.getByText('AI Fix Test Failures')).toBeInTheDocument();
    expect(screen.getByText('on error')).toBeInTheDocument();
  });

  it('offers no way to edit, and says why', () => {
    render(<WorkflowMobileView workflow={workflow()} onBack={vi.fn()} />);
    // Authoring is dropped wholesale below md rather than disabled field by field.
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.getByText(/needs the graph editor/i)).toBeInTheDocument();
  });

  it('reveals a step config on tap', () => {
    render(<WorkflowMobileView workflow={workflow()} onBack={vi.fn()} />);
    expect(screen.queryByText('pnpm test')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Run Tests/ }));
    expect(screen.getByText('pnpm test')).toBeInTheDocument();
  });

  it('runs the workflow — not editable does not mean not actionable', async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(<WorkflowMobileView workflow={workflow()} onBack={vi.fn()} onRun={onRun} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
  });

  it('surfaces a failed run instead of silently doing nothing', async () => {
    const onRun = vi.fn().mockRejectedValue(new Error('backend unreachable'));
    render(<WorkflowMobileView workflow={workflow()} onBack={vi.fn()} onRun={onRun} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByText('backend unreachable')).toBeInTheDocument();
  });

  it('hides Run when the caller cannot trigger this workflow', () => {
    render(<WorkflowMobileView workflow={workflow()} onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  });

  it('goes back', () => {
    const onBack = vi.fn();
    render(<WorkflowMobileView workflow={workflow()} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to workflows' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('warns when branches rejoin and the list cannot show it', () => {
    const wf = workflow({
      definition: {
        entryNodeId: 'c',
        nodes: [
          { id: 'c', name: 'Check', type: 'condition', config: {}, position: { x: 0, y: 0 } },
          { id: 'a', name: 'A', type: 'shell', config: {}, position: { x: 0, y: 0 } },
          { id: 'b', name: 'B', type: 'shell', config: {}, position: { x: 0, y: 0 } },
          { id: 'end', name: 'End', type: 'notify', config: {}, position: { x: 0, y: 0 } },
        ],
        edges: [
          { id: '1', source: 'c', target: 'a', type: 'condition_true' },
          { id: '2', source: 'c', target: 'b', type: 'condition_false' },
          { id: '3', source: 'a', target: 'end', type: 'success' },
          { id: '4', source: 'b', target: 'end', type: 'success' },
        ],
      },
    } as unknown as Partial<Workflow>);
    render(<WorkflowMobileView workflow={wf} onBack={vi.fn()} />);
    expect(screen.getByText(/Continues at/)).toBeInTheDocument();
    expect(screen.getByText(/rejoin each other/i)).toBeInTheDocument();
  });
});
