// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RecordStatus } from '@zclaudia/shared/core/record-status';
import { StatusChip } from './StatusChip';

const ready: RecordStatus = { completeness: 'ready', availability: { usable: true } };

describe('StatusChip', () => {
  it('renders nothing for a ready record', () => {
    const { container } = render(<StatusChip status={ready} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows "Draft" (muted) for a draft record', () => {
    render(<StatusChip status={{ completeness: 'draft', availability: { usable: true } }} />);
    const chip = screen.getByText('Draft');
    expect(chip.className).toContain('text-muted-foreground');
  });

  it('shows "Disabled" (muted) for a disabled record', () => {
    render(
      <StatusChip
        status={{ completeness: 'ready', availability: { usable: true }, disabled: true }}
      />
    );
    expect(screen.getByText('Disabled').className).toContain('text-muted-foreground');
  });

  it('shows the reason label (warning) for an unavailable record', () => {
    render(
      <StatusChip
        status={{ completeness: 'ready', availability: { usable: false, reason: 'needs_auth' } }}
      />
    );
    const chip = screen.getByText('Needs auth');
    expect(chip.className).toContain('text-warning');
  });

  it('maps requirement_unmet to "Blocked"', () => {
    render(
      <StatusChip
        status={{
          completeness: 'ready',
          availability: { usable: false, reason: 'requirement_unmet' },
        }}
      />
    );
    expect(screen.getByText('Blocked')).toBeInTheDocument();
  });

  it('draft outranks an unavailable reason (draft dominates the chip)', () => {
    render(
      <StatusChip
        status={{ completeness: 'draft', availability: { usable: false, reason: 'needs_auth' } }}
      />
    );
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.queryByText('Needs auth')).toBeNull();
  });
});
