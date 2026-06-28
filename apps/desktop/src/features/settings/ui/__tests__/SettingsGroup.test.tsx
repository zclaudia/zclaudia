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
