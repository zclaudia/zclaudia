import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Select } from '../Select';

const OPTIONS = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana' },
  { value: 'c', label: 'Cherry', disabled: true },
  { value: 'd', label: 'Date' },
];

function renderSelect(value = 'a', onChange = vi.fn()) {
  render(<Select value={value} onChange={onChange} options={OPTIONS} ariaLabel="Fruit" />);
  return {
    onChange,
    trigger: () => screen.getByRole('button', { name: 'Fruit' }),
    listbox: () => screen.getByRole('listbox'),
  };
}

describe('Select keyboard navigation', () => {
  it('opens on ArrowDown and highlights the selected option', () => {
    const { trigger, listbox } = renderSelect('a');
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(listbox().getAttribute('aria-activedescendant')).toMatch(/opt-0$/);
  });

  it('ArrowDown skips a disabled option', () => {
    const { trigger, listbox } = renderSelect('b');
    fireEvent.click(trigger()); // open, highlights index 1 (Banana)
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' }); // 2 is disabled -> 3 (Date)
    expect(listbox().getAttribute('aria-activedescendant')).toMatch(/opt-3$/);
  });

  it('Home / End jump to the first / last enabled option', () => {
    const { trigger, listbox } = renderSelect('b');
    fireEvent.click(trigger());
    fireEvent.keyDown(listbox(), { key: 'End' });
    expect(listbox().getAttribute('aria-activedescendant')).toMatch(/opt-3$/);
    fireEvent.keyDown(listbox(), { key: 'Home' });
    expect(listbox().getAttribute('aria-activedescendant')).toMatch(/opt-0$/);
  });

  it('Enter selects the highlighted option and closes', () => {
    const { onChange, trigger, listbox } = renderSelect('a');
    fireEvent.click(trigger()); // highlights index 0
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' }); // -> index 1 (Banana)
    fireEvent.keyDown(listbox(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('type-ahead highlights the matching option', () => {
    const { trigger, listbox } = renderSelect('a');
    fireEvent.click(trigger());
    fireEvent.keyDown(listbox(), { key: 'd' }); // Date
    expect(listbox().getAttribute('aria-activedescendant')).toMatch(/opt-3$/);
  });

  it('closes on Tab so focus can proceed', () => {
    const { trigger, listbox } = renderSelect('a');
    fireEvent.click(trigger());
    fireEvent.keyDown(listbox(), { key: 'Tab' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
