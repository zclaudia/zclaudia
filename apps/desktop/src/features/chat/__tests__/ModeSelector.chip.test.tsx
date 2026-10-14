// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderCapabilities } from '@zclaudia/shared/core/runtime-capabilities';
import { ModeSelector } from '../ModeSelector';

const caps = (ids: string[]) =>
  ({
    modes: ids.map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
  }) as unknown as ProviderCapabilities;

afterEach(cleanup);

describe('ModeSelector chip variant', () => {
  it('renders a Default/Plan pair as a Plan toggle', () => {
    const onChange = vi.fn();
    render(
      <ModeSelector
        capabilities={caps(['default', 'plan'])}
        value="default"
        onChange={onChange}
        variant="chip"
      />
    );
    const toggle = screen.getByRole('button', { name: 'Plan mode' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith('plan');
  });

  it('toggles back to the non-plan mode when Plan is on', () => {
    const onChange = vi.fn();
    render(
      <ModeSelector
        capabilities={caps(['default', 'plan'])}
        value="plan"
        onChange={onChange}
        variant="chip"
      />
    );
    const toggle = screen.getByRole('button', { name: 'Plan mode' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith('default');
  });

  it('disables the toggle when locked', () => {
    render(
      <ModeSelector
        capabilities={caps(['default', 'plan'])}
        value="plan"
        onChange={vi.fn()}
        locked
        lockReason="Locked by Supervisor planning mode"
        variant="chip"
      />
    );
    expect(screen.getByRole('button', { name: 'Plan mode' })).toBeDisabled();
  });

  it('keeps the dropdown when the runtime offers other modes', () => {
    render(
      <ModeSelector
        capabilities={caps(['default', 'plan', 'auto'])}
        value="default"
        onChange={vi.fn()}
        variant="chip"
      />
    );
    expect(screen.queryByRole('button', { name: 'Plan mode' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Agent mode' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('keeps the dropdown in the default variant', () => {
    render(
      <ModeSelector capabilities={caps(['default', 'plan'])} value="default" onChange={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Agent mode' })).toBeInTheDocument();
  });
});
