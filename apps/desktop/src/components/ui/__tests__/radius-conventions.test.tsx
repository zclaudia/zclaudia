import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FIELD_CLASS, FIELD_CLASS_LG } from '../Input';
import { Select } from '../Select';

/**
 * Pins the control-tier radius (rounded-md) on the shared field primitives so
 * the pill/xl regressions documented in docs/ui-conventions.md §9 can't return.
 */
describe('radius conventions', () => {
  it('FIELD_CLASS uses the control-tier radius', () => {
    expect(FIELD_CLASS).toContain('rounded-md');
    expect(FIELD_CLASS).not.toContain('rounded-full');
  });

  it('FIELD_CLASS_LG keeps the same radius with comfortable padding', () => {
    expect(FIELD_CLASS_LG).toContain('rounded-md');
    expect(FIELD_CLASS_LG).toContain('px-3 py-2');
  });

  it('Select trigger uses rounded-md, not a pill', () => {
    render(
      <Select
        value=""
        onChange={() => {}}
        options={[{ value: 'a', label: 'A' }]}
        ariaLabel="pick"
      />
    );
    const trigger = screen.getByRole('button', { name: 'pick' });
    expect(trigger.className).toContain('rounded-md');
    expect(trigger.className).not.toContain('rounded-full');
  });

  it('Select panel keeps the panel-tier radius', () => {
    render(
      <Select
        value=""
        onChange={() => {}}
        options={[{ value: 'a', label: 'A' }]}
        ariaLabel="pick"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'pick' }));
    expect(screen.getByRole('listbox').className).toContain('rounded-xl');
  });
});
