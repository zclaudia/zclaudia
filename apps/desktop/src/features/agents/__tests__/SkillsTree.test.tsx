// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SkillsTree } from '../SkillsTree';
import type { AgentsBackend, AgentsSelection } from '../agents-types';
import type { SkillsByBackend } from '../useSkillsByBackend';

const backends: AgentsBackend[] = [
  { backendId: 'b1', name: 'Local Server', online: true },
  { backendId: 'b2', name: 'Remote Server', online: false },
];

function emptyData(overrides?: Partial<SkillsByBackend>): SkillsByBackend {
  return {
    skills: new Map(),
    diagnostics: new Map(),
    dirs: new Map(),
    dirsFailed: new Set(),
    errors: new Map(),
    loading: false,
    ...overrides,
  };
}

const baseProps = {
  backends,
  data: emptyData(),
  selection: null as AgentsSelection | null,
  expandedBackendIds: [] as string[],
  onToggleBackend: vi.fn(),
  onSelectItem: vi.fn(),
};

describe('SkillsTree', () => {
  it('renders one group per backend, in order', () => {
    render(<SkillsTree {...baseProps} />);
    expect(screen.getByText('Local Server')).toBeInTheDocument();
    expect(screen.getByText('Remote Server')).toBeInTheDocument();
  });

  it('online group shows a success status dot', () => {
    render(<SkillsTree {...baseProps} />);
    const row = screen.getByText('Local Server').closest('button')!;
    const dot = row.querySelector('span.h-2.w-2')!;
    expect(dot.className).toContain('bg-success');
  });

  it('offline group shows a muted status dot and is dimmed', () => {
    render(<SkillsTree {...baseProps} />);
    const row = screen.getByText('Remote Server').closest('button')!;
    const dot = row.querySelector('span.h-2.w-2')!;
    expect(dot.className).toContain('bg-muted-foreground');
    expect(dot.className).not.toContain('bg-success');

    const header = screen.getByText('Remote Server').closest('div.group')!;
    expect(header.className).toContain('opacity-60');
  });

  it('offline group has no chevron and no + button', () => {
    render(<SkillsTree {...baseProps} />);
    const header = screen.getByText('Remote Server').closest('div.group')!;
    expect(header.querySelector('svg.lucide-chevron-right')).toBeNull();
    expect(header.querySelector('button[aria-label="New skill"]')).toBeNull();
  });

  it('clicking offline group header does not call onToggleBackend', () => {
    const onToggleBackend = vi.fn();
    render(<SkillsTree {...baseProps} onToggleBackend={onToggleBackend} />);
    fireEvent.click(screen.getByText('Remote Server'));
    expect(onToggleBackend).not.toHaveBeenCalled();
  });

  it('clicking online group header calls onToggleBackend with backendId', () => {
    const onToggleBackend = vi.fn();
    render(<SkillsTree {...baseProps} onToggleBackend={onToggleBackend} />);
    fireEvent.click(screen.getByText('Local Server'));
    expect(onToggleBackend).toHaveBeenCalledWith('b1');
  });

  it('children do not render when backend is not expanded', () => {
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b1', []]]) })}
        expandedBackendIds={[]}
      />
    );
    expect(screen.queryByText('No skills')).toBeNull();
  });

  it('offline group children never render even if included in expandedBackendIds', () => {
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b2', []]]) })}
        expandedBackendIds={['b2']}
      />
    );
    expect(screen.queryByText('No skills')).toBeNull();
  });

  it('expanded online group with loading and no entry yet shows Loading…', () => {
    render(
      <SkillsTree {...baseProps} data={emptyData({ loading: true })} expandedBackendIds={['b1']} />
    );
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('keeps showing existing skills during a background refetch (stale-while-refetch)', () => {
    const skills = [{ id: 's1', name: 'Refactorer' } as any];
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ loading: true, skills: new Map([['b1', skills]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('Refactorer')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('expanded online group with an error shows error text', () => {
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ errors: new Map([['b1', 'boom']]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText("Couldn't load skills")).toBeInTheDocument();
  });

  it('error state still renders the footer row (dirs are fetched independently)', () => {
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ errors: new Map([['b1', 'boom']]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText("Couldn't load skills")).toBeInTheDocument();
    expect(screen.getByText('External directories')).toBeInTheDocument();
  });

  it('expanded online group with empty skill array shows No skills, then the footer row', () => {
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b1', []]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('No skills')).toBeInTheDocument();
    expect(screen.getByText('External directories')).toBeInTheDocument();
  });

  it('expanded online group renders skill rows', () => {
    const skills = [
      { id: 's1', name: 'Refactorer' } as any,
      { id: 's2', name: 'Test Writer' } as any,
    ];
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b1', skills]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('Refactorer')).toBeInTheDocument();
    expect(screen.getByText('Test Writer')).toBeInTheDocument();
  });

  it('skill row falls back to id when name is missing', () => {
    const skills = [{ id: 's1', name: '' } as any];
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b1', skills]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('s1')).toBeInTheDocument();
  });

  it('clicking a skill row fires onSelectItem with kind skill', () => {
    const onSelectItem = vi.fn();
    const skills = [{ id: 's1', name: 'Refactorer' } as any];
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b1', skills]]) })}
        expandedBackendIds={['b1']}
        onSelectItem={onSelectItem}
      />
    );
    fireEvent.click(screen.getByText('Refactorer'));
    expect(onSelectItem).toHaveBeenCalledWith({ backendId: 'b1', kind: 'skill', id: 's1' });
  });

  it('selected skill row has bg-secondary styling', () => {
    const skills = [{ id: 's1', name: 'Refactorer' } as any];
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b1', skills]]) })}
        expandedBackendIds={['b1']}
        selection={{ backendId: 'b1', kind: 'skill', id: 's1' }}
      />
    );
    const row = screen.getByText('Refactorer').closest('button')!;
    expect(row.className).toContain('bg-secondary');
  });

  it('unselected skill row does not have bg-secondary styling', () => {
    const skills = [{ id: 's1', name: 'Refactorer' } as any];
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b1', skills]]) })}
        expandedBackendIds={['b1']}
        selection={{ backendId: 'b1', kind: 'skill', id: 's2' }}
      />
    );
    const row = screen.getByText('Refactorer').closest('button')!;
    expect(row.className.split(/\s+/)).not.toContain('bg-secondary');
  });

  it('external skill shows a source tag', () => {
    const skills = [{ id: 's1', name: 'Refactorer', source: 'external' } as any];
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b1', skills]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('external')).toBeInTheDocument();
  });

  it('plugin skill shows a source tag', () => {
    const skills = [{ id: 's1', name: 'Refactorer', source: 'plugin' } as any];
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b1', skills]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('plugin')).toBeInTheDocument();
  });

  it('workspace skill shows no source tag', () => {
    const skills = [{ id: 's1', name: 'Refactorer', source: 'workspace' } as any];
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b1', skills]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.queryByText('workspace')).toBeNull();
  });

  it('skill with eligible === false shows a blocked tag', () => {
    const skills = [{ id: 's1', name: 'Refactorer', eligible: false } as any];
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b1', skills]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('blocked')).toBeInTheDocument();
  });

  it('eligible skill shows no blocked tag', () => {
    const skills = [{ id: 's1', name: 'Refactorer', eligible: true } as any];
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b1', skills]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.queryByText('blocked')).toBeNull();
  });

  it('online group has a + button with New skill label', () => {
    render(<SkillsTree {...baseProps} />);
    expect(screen.getByRole('button', { name: 'New skill' })).toBeInTheDocument();
  });

  it('clicking + fires onSelectItem with kind new-skill', () => {
    const onSelectItem = vi.fn();
    render(<SkillsTree {...baseProps} onSelectItem={onSelectItem} />);
    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));
    expect(onSelectItem).toHaveBeenCalledWith({ backendId: 'b1', kind: 'new-skill' });
  });

  it('clicking the footer row fires onSelectItem with kind skill-dirs', () => {
    const onSelectItem = vi.fn();
    const skills = [{ id: 's1', name: 'Refactorer' } as any];
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b1', skills]]) })}
        expandedBackendIds={['b1']}
        onSelectItem={onSelectItem}
      />
    );
    fireEvent.click(screen.getByText('External directories'));
    expect(onSelectItem).toHaveBeenCalledWith({ backendId: 'b1', kind: 'skill-dirs' });
  });

  it('footer row has bg-secondary styling when skill-dirs is selected', () => {
    const skills = [{ id: 's1', name: 'Refactorer' } as any];
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b1', skills]]) })}
        expandedBackendIds={['b1']}
        selection={{ backendId: 'b1', kind: 'skill-dirs' }}
      />
    );
    const row = screen.getByText('External directories').closest('button')!;
    expect(row.className).toContain('bg-secondary');
  });

  it('footer row is not selected when selection belongs to another backend', () => {
    const skills = [{ id: 's1', name: 'Refactorer' } as any];
    render(
      <SkillsTree
        {...baseProps}
        data={emptyData({ skills: new Map([['b1', skills]]) })}
        expandedBackendIds={['b1']}
        selection={{ backendId: 'b2', kind: 'skill-dirs' }}
      />
    );
    const row = screen.getByText('External directories').closest('button')!;
    expect(row.className.split(/\s+/)).not.toContain('bg-secondary');
  });
});
