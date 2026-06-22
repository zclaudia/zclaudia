import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LlmProfileConfig } from '@zclaudia/shared';
import { CodexOAuthSection } from '../CodexOAuthSection';
import { useServerStore } from '../../../stores/serverStore';
import { startCodexOAuth } from '../../../services/api/llm-profiles';

vi.mock('../../../services/api/llm-profiles', () => ({
  fetchCodexModels: vi.fn(),
  signOutCodexOAuth: vi.fn(),
  startCodexOAuth: vi.fn(),
  pollCodexOAuthStatus: vi.fn(),
  cancelCodexOAuth: vi.fn(),
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
    useServerStore.setState({ activeServerId: 'local' } as any);
  });

  it('shows an inline error when the profile cannot be saved before sign-in', async () => {
    render(
      <CodexOAuthSection
        profile={profile}
        onCredentialsChanged={vi.fn()}
        onBeforeSignIn={vi.fn(async () => null)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with ChatGPT' }));

    await waitFor(() => {
      expect(screen.getByText('Failed to save the profile before signing in. Please fix the form errors first.')).toBeInTheDocument();
    });
    expect(startCodexOAuth).not.toHaveBeenCalled();
  });
});
