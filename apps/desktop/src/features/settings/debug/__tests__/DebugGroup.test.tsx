import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DebugGroup, DebugSection } from '../DebugGroup';

describe('DebugGroup', () => {
  it('renders the group label and section title/description/actions', () => {
    render(
      <DebugGroup label="Diagnostics">
        <DebugSection
          title="Crash reports"
          description="Recent crashes."
          actions={<button>Refresh</button>}
        >
          <div>body content</div>
        </DebugSection>
      </DebugGroup>
    );
    expect(screen.getByText('Diagnostics')).toBeTruthy();
    expect(screen.getByText('Crash reports')).toBeTruthy();
    expect(screen.getByText('Recent crashes.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(screen.getByText('body content')).toBeTruthy();
  });
});
