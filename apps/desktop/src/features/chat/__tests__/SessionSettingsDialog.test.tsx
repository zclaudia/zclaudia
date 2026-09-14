import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionSettingsDialog } from '../SessionSettingsDialog';
import { getSessionModelSettings } from '../../../services/api/sessions';
import { useSessionOverridesStore } from '../../../stores/sessionOverridesStore';
import { useSessionConfigStore } from '../../../stores/sessionConfigStore';
vi.mock('../../../services/api/sessions', () => ({ getSessionModelSettings: vi.fn() }));
beforeEach(() => {
  useSessionOverridesStore.setState({ permissionOverrides: {} });
  useSessionConfigStore.setState({ modeBySession: {}, runtimeModes: {} });
  vi.mocked(getSessionModelSettings).mockResolvedValue({
    supportsPermissionOverrides: true,
    permissionNote: 'Host requests only',
  } as never);
});
describe('session approval settings', () => {
  it('changes host approval rules from session settings', async () => {
    render(<SessionSettingsDialog sessionId="s" isMobile={false} onClose={() => {}} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Permission mode: Project Default' })
    );
    fireEvent.click(screen.getByText('Ask Before Edits'));
    expect(useSessionOverridesStore.getState().permissionOverrides.s?.profile).toMatchObject({
      fileWrite: 'ask',
      destructiveOps: 'block',
    });
  });
  it('shows CLI-managed permissions for legacy Cursor sessions', async () => {
    vi.mocked(getSessionModelSettings).mockResolvedValue({
      supportsPermissionOverrides: false,
      permissionNote: 'CLI controls native tools',
    } as never);
    render(<SessionSettingsDialog sessionId="s" isMobile onClose={() => {}} />);
    expect(await screen.findByText('CLI-managed permissions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Permission mode/ })).not.toBeInTheDocument();
  });
  it('does not offer ineffective host overrides in bypass mode', async () => {
    useSessionConfigStore.setState({ modeBySession: { s: 'bypassPermissions' } });
    render(<SessionSettingsDialog sessionId="s" isMobile={false} onClose={() => {}} />);
    expect(
      await screen.findByRole('button', { name: 'Permission mode: Project Default' })
    ).toBeDisabled();
  });
});
