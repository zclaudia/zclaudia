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
