// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Checkbox } from '../Checkbox';

describe('Checkbox', () => {
  it('exposes the input by its aria-label and reports changes', () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="enable web tools" checked={false} onChange={onChange} />);
    const input = screen.getByLabelText('enable web tools');
    expect(input).toHaveAttribute('type', 'checkbox');
    fireEvent.click(input);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('wraps the input in a padded label so taps land outside the 16px box', () => {
    render(<Checkbox aria-label="enable web tools" checked={false} readOnly />);
    const wrapper = screen.getByLabelText('enable web tools').closest('label')!;
    // Padding grows the tap target to 40px; the equal negative margin keeps the
    // control's layout footprint at 16px so rows do not shift.
    expect(wrapper.className).toContain('p-3');
    expect(wrapper.className).toContain('-m-3');
    // Mouse-driven widths do not need the extra target.
    expect(wrapper.className).toContain('md:p-0');
    expect(wrapper.className).toContain('md:m-0');
  });

  it('clicking the padded area toggles the input', () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="enable web tools" checked={false} onChange={onChange} />);
    const wrapper = screen.getByLabelText('enable web tools').closest('label')!;
    fireEvent.click(wrapper);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
