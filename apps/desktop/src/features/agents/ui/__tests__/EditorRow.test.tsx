// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditorSection, EditorRow } from '../EditorSection';

describe('EditorRow', () => {
  it('renders title, description, and a right-aligned control', () => {
    render(<EditorRow title="Agent Type" description="Required" control={<button>ctl</button>} />);
    expect(screen.getByText('Agent Type')).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ctl' })).toBeInTheDocument();
  });

  it('stacks label and control vertically below md and restores the row layout at md', () => {
    const { container } = render(<EditorRow title="Agent Type" control={<button>ctl</button>} />);
    const row = container.querySelector('.flex.flex-col');
    expect(row).not.toBeNull();
    expect(row!.className).toContain('md:flex-row');
    expect(row!.className).toContain('md:items-center');
    expect(row!.className).toContain('md:justify-between');
    // Control wrapper only pins its width from md up so it can stretch when stacked.
    const controlWrap = screen.getByRole('button', { name: 'ctl' }).parentElement!;
    expect(controlWrap.className).toContain('md:flex-shrink-0');
    expect(controlWrap.className).not.toMatch(/(^| )flex-shrink-0/);
  });

  it('uses items-start alignment at md when align="start"', () => {
    const { container } = render(<EditorRow title="Row" align="start" control={<span>c</span>} />);
    const row = container.querySelector('.flex.flex-col');
    expect(row!.className).toContain('md:items-start');
    expect(row!.className).not.toContain('md:items-center');
  });

  it('renders a full-width body below the row when children are provided', () => {
    render(
      <EditorRow title="Row" control={<span>c</span>}>
        body content
      </EditorRow>
    );
    expect(screen.getByText('body content')).toBeInTheDocument();
  });
});

describe('EditorSection flush', () => {
  it('flush section renders children without the default padded stack', () => {
    const { container } = render(
      <EditorSection title="Runtime & model" flush>
        <div data-testid="rowzone">rows</div>
      </EditorSection>
    );
    // The default non-flush body wrapper class must not be present.
    expect(container.querySelector('.space-y-3.p-4')).toBeNull();
    expect(screen.getByTestId('rowzone')).toBeInTheDocument();
  });
});
