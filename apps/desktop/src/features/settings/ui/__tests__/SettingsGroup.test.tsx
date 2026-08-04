import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsGroup, SettingsRow } from '../SettingsGroup';

describe('SettingsGroup / SettingsRow', () => {
  it('renders the group label, row title/description/control and body', () => {
    render(
      <SettingsGroup label="Appearance">
        <SettingsRow
          icon={<span data-testid="icon" />}
          title="Theme"
          description="Pick a theme."
          control={<button>Light</button>}
        >
          <div>body</div>
        </SettingsRow>
      </SettingsGroup>
    );
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.getByText('Pick a theme.')).toBeTruthy();
    expect(screen.getByTestId('icon')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Light' })).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('renders without optional icon/description/control/body', () => {
    render(
      <SettingsGroup label="About">
        <SettingsRow title="Version" />
      </SettingsGroup>
    );
    expect(screen.getByText('Version')).toBeTruthy();
  });

  it('stacks label and control vertically below md and restores the row layout at md', () => {
    const { container } = render(
      <SettingsGroup>
        <SettingsRow title="Theme" control={<button>Light</button>} />
      </SettingsGroup>
    );
    const row = container.querySelector('.flex.flex-col');
    expect(row).not.toBeNull();
    expect(row!.className).toContain('md:flex-row');
    expect(row!.className).toContain('md:items-center');
    expect(row!.className).toContain('md:justify-between');
    // Control wrapper only pins its width from md up so it can stretch when stacked.
    const controlWrap = screen.getByRole('button', { name: 'Light' }).parentElement!;
    expect(controlWrap.className).toContain('md:flex-shrink-0');
    expect(controlWrap.className).not.toMatch(/(^| )flex-shrink-0/);
  });

  it('uses items-start alignment at md when align="start"', () => {
    const { container } = render(
      <SettingsGroup>
        <SettingsRow title="Row" align="start" control={<span>c</span>} />
      </SettingsGroup>
    );
    const row = container.querySelector('.flex.flex-col');
    expect(row!.className).toContain('md:items-start');
    expect(row!.className).not.toContain('md:items-center');
  });

  it('omits the label heading when no label is given', () => {
    const { container } = render(
      <SettingsGroup>
        <SettingsRow title="Master" />
      </SettingsGroup>
    );
    expect(container.querySelector('h4')).toBeNull();
    expect(screen.getByText('Master')).toBeTruthy();
  });
});
