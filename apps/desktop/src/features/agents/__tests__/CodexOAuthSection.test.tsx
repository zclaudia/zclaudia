import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LlmProfileConfig } from '@zclaudia/shared';
import { CodexOAuthSection } from '../CodexOAuthSection';
import { useFacadeStore } from '../../../stores/facadeStore';
import {
  fetchCodexModelsForBackend,
  startCodexOAuthForBackend,
  updateLlmProfileForBackend,
} from '../../../services/api';

// Both the section and the login modal it opens import from the services/api
// barrel, so one mock covers the whole OAuth surface.
vi.mock('../../../services/api', () => ({
  fetchCodexModelsForBackend: vi.fn(),
  signOutCodexOAuthForBackend: vi.fn(),
  updateLlmProfileForBackend: vi.fn(),
  startCodexOAuthForBackend: vi.fn(),
  pollCodexOAuthStatusForBackend: vi.fn(),
  cancelCodexOAuthForBackend: vi.fn(),
}));

describe('CodexOAuthSection', () => {
  const profile: LlmProfileConfig = {
    id: 'codex-profile',
    name: 'OpenAI Codex',
    providerType: 'openai-codex',
    isDefault: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // The method decision keys on isLocalBackendId(backendId): the legacy
    // 'local' id is local by definition; anything else is remote with the
    // facade store empty.
    useFacadeStore.setState({ localBackendId: null, backends: [] } as any);
    vi.mocked(fetchCodexModelsForBackend).mockResolvedValue({
      models: [],
      fetchedAt: Date.now(),
      source: 'fallback',
    });
    vi.mocked(updateLlmProfileForBackend).mockResolvedValue(profile);
  });

  it('shows an inline error when the profile cannot be saved before sign-in', async () => {
    render(
      <CodexOAuthSection
        backendId="local"
        profile={profile}
        onCredentialsChanged={vi.fn()}
        onBeforeSignIn={vi.fn(async () => null)}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with ChatGPT' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Failed to save the profile before signing in. Please fix the form errors first.'
        )
      ).toBeInTheDocument();
    });
    expect(startCodexOAuthForBackend).not.toHaveBeenCalled();
  });

  it('starts browser OAuth for a local backend when Sign in is clicked', async () => {
    vi.mocked(startCodexOAuthForBackend).mockResolvedValue({
      sessionId: 'oauth-session',
      method: 'browser',
      authUrl: 'https://auth.openai.com/oauth/authorize?client_id=codex',
    });

    render(
      <CodexOAuthSection backendId="local" profile={profile} onCredentialsChanged={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with ChatGPT' }));

    await waitFor(() => {
      expect(startCodexOAuthForBackend).toHaveBeenCalledWith('local', 'codex-profile', 'browser');
    });
    expect(screen.getByRole('link', { name: 'Open authorization page' })).toHaveAttribute(
      'href',
      'https://auth.openai.com/oauth/authorize?client_id=codex'
    );
  });

  it('starts the device-code OAuth flow for a remote backend when Sign in is clicked', async () => {
    vi.mocked(startCodexOAuthForBackend).mockResolvedValue({
      sessionId: 'oauth-session',
      method: 'device_code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://auth.openai.com/codex/device',
      expiresAt: Date.now() + 900_000,
    });

    render(
      <CodexOAuthSection backendId="remote-1" profile={profile} onCredentialsChanged={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with ChatGPT' }));

    await waitFor(() => {
      expect(startCodexOAuthForBackend).toHaveBeenCalledWith(
        'remote-1',
        'codex-profile',
        'device_code'
      );
    });
    expect(screen.getByText('ABCD-1234')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open authorization page' });
    expect(link).toHaveAttribute('href', 'https://auth.openai.com/codex/device');
    expect(link.getAttribute('href')).not.toContain('user_code');
    expect(
      screen.getByText('Device code authorization must be enabled for Codex.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View OpenAI authentication docs' })).toHaveAttribute(
      'href',
      'https://developers.openai.com/codex/auth#preferred-device-code-authentication-beta'
    );
  });

  it('syncs fetched Codex models back onto the profile', async () => {
    const onCredentialsChanged = vi.fn();
    vi.mocked(fetchCodexModelsForBackend).mockResolvedValue({
      models: [{ id: 'gpt-5-codex', displayName: 'GPT-5 Codex', contextWindow: 272_000 }],
      fetchedAt: Date.now(),
      source: 'live',
    });

    render(
      <CodexOAuthSection
        backendId="local"
        profile={{
          ...profile,
          oauthCredentials: {
            access: 'access-token',
            refresh: 'refresh-token',
            expires: Date.now() + 60_000,
            accountId: 'acct_1',
          },
        }}
        onCredentialsChanged={onCredentialsChanged}
      />
    );

    await waitFor(() => {
      expect(updateLlmProfileForBackend).toHaveBeenCalledWith('local', 'codex-profile', {
        models: [{ modelId: 'gpt-5-codex', displayName: 'GPT-5 Codex', contextWindow: 272_000 }],
      });
    });
    expect(onCredentialsChanged).toHaveBeenCalled();
  });
});
