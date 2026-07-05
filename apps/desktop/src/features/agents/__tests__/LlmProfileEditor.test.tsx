// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LlmProfileConfig } from '@zclaudia/shared';

import { LlmProfileEditor } from '../LlmProfileEditor';
import * as api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  createLlmProfileForBackend: vi.fn(),
  updateLlmProfileForBackend: vi.fn(),
  deleteLlmProfileForBackend: vi.fn(),
  setDefaultLlmProfileForBackend: vi.fn(),
  fetchModelsForLlmProfilePreviewForBackend: vi.fn(),
  probeLlmProfileModelPreviewForBackend: vi.fn(),
  resolveContextWindowPreviewForBackend: vi.fn(),
}));

vi.mock('../CodexOAuthSection', () => ({
  CodexOAuthSection: ({ backendId }: { backendId: string }) => (
    <div data-testid="codex-oauth-section">{backendId}</div>
  ),
}));

function makeProfile(overrides: Partial<LlmProfileConfig> = {}): LlmProfileConfig {
  return {
    id: 'p1',
    name: 'My Anthropic',
    providerType: 'anthropic',
    models: [{ modelId: 'claude-x' }],
    isDefault: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function renderEditor(profile: LlmProfileConfig | null) {
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  const view = render(
    <LlmProfileEditor backendId="b1" profile={profile} onSaved={onSaved} onDeleted={onDeleted} />
  );
  return { onSaved, onDeleted, ...view };
}

describe('LlmProfileEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createLlmProfileForBackend).mockResolvedValue(makeProfile({ id: 'created-1' }));
    vi.mocked(api.updateLlmProfileForBackend).mockResolvedValue(makeProfile());
    vi.mocked(api.deleteLlmProfileForBackend).mockResolvedValue({ ok: true });
    vi.mocked(api.setDefaultLlmProfileForBackend).mockResolvedValue(undefined);
    vi.mocked(api.fetchModelsForLlmProfilePreviewForBackend).mockResolvedValue({
      ok: true,
      models: ['claude-new'],
    });
    vi.mocked(api.probeLlmProfileModelPreviewForBackend).mockResolvedValue({
      ok: true,
      latencyMs: 42,
    });
    vi.mocked(api.resolveContextWindowPreviewForBackend).mockResolvedValue({
      value: 200000,
      source: 'pi_ai_registry',
    });
  });

  it('create mode: saves via createLlmProfileForBackend and fires onSaved with the new id', async () => {
    const { onSaved } = renderEditor(null);

    fireEvent.change(screen.getByPlaceholderText('e.g., Local ZClaudia Agent'), {
      target: { value: 'My Provider' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Add model' }));
    fireEvent.change(screen.getByLabelText('model id'), { target: { value: 'claude-x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.createLlmProfileForBackend).toHaveBeenCalledWith('b1', {
        name: 'My Provider',
        providerType: 'anthropic',
        baseUrl: undefined,
        apiKey: undefined,
        compat: undefined,
        requestHeaders: undefined,
        models: [{ modelId: 'claude-x' }],
        isDefault: false,
      });
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('created-1');
    });
  });

  it('create mode: no model rows disables save (F2 hard gate)', () => {
    renderEditor(null);

    fireEvent.change(screen.getByPlaceholderText('e.g., Local ZClaudia Agent'), {
      target: { value: 'My Provider' },
    });

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(api.createLlmProfileForBackend).not.toHaveBeenCalled();
  });

  it('edit mode: populates the form and updates via updateLlmProfileForBackend', async () => {
    const { onSaved } = renderEditor(makeProfile());

    fireEvent.change(screen.getByDisplayValue('My Anthropic'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(api.updateLlmProfileForBackend).toHaveBeenCalledWith(
        'b1',
        'p1',
        expect.objectContaining({
          name: 'Renamed',
          providerType: 'anthropic',
          models: [{ modelId: 'claude-x' }],
          cacheRetention: null,
        })
      );
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('p1');
    });
  });

  it('edit mode: reserved request header blocks save with an inline error', async () => {
    const { onSaved } = renderEditor(makeProfile());

    fireEvent.change(screen.getByPlaceholderText(/X-Org-Id/), {
      target: { value: '{"Authorization": "Bearer x"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        'Header "Authorization" is reserved (managed by API key); remove it from Request Headers'
      )
    ).toBeInTheDocument();
    expect(api.updateLlmProfileForBackend).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('edit mode: shows an inline error when save fails (no alert)', async () => {
    vi.mocked(api.updateLlmProfileForBackend).mockRejectedValue(new Error('save boom'));

    const { onSaved } = renderEditor(makeProfile());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Failed to update provider: save boom')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('delete: first click arms confirmation, second click deletes and fires onDeleted', async () => {
    const { onDeleted } = renderEditor(makeProfile());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.deleteLlmProfileForBackend).not.toHaveBeenCalled();

    const confirmButton = await screen.findByRole('button', { name: 'Confirm delete' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(api.deleteLlmProfileForBackend).toHaveBeenCalledWith('b1', 'p1');
    });
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it('delete: 409 IN_USE renders the agent-count message and skips onDeleted', async () => {
    vi.mocked(api.deleteLlmProfileForBackend).mockResolvedValue({
      ok: false,
      code: 'IN_USE',
      message: 'in use',
      agentCount: 2,
    });

    const { onDeleted } = renderEditor(makeProfile());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }));

    expect(
      await screen.findByText(
        'This LLM profile is used by 2 agent profiles. Edit those agents to bind a different profile before deleting.'
      )
    ).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('set default fires setDefaultLlmProfileForBackend and onSaved', async () => {
    const { onSaved } = renderEditor(makeProfile());

    fireEvent.click(screen.getByRole('button', { name: 'Set default' }));

    await waitFor(() => {
      expect(api.setDefaultLlmProfileForBackend).toHaveBeenCalledWith('b1', 'p1');
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('p1');
    });
  });

  it('set default button is hidden for the default profile', () => {
    renderEditor(makeProfile({ isDefault: true }));

    expect(screen.queryByRole('button', { name: 'Set default' })).toBeNull();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('openai-codex profile hides baseUrl/apiKey inputs and shows the OAuth section', () => {
    renderEditor(makeProfile({ providerType: 'openai-codex', models: [] }));

    expect(screen.queryByPlaceholderText('http://api.example.com/v1')).toBeNull();
    expect(screen.queryByPlaceholderText('sk-...')).toBeNull();
    expect(screen.getByTestId('codex-oauth-section')).toHaveTextContent('b1');
  });

  it('fetch models calls the ForBackend preview api with the form draft and opens the picker', async () => {
    renderEditor(makeProfile());

    fireEvent.click(screen.getByRole('button', { name: 'Fetch from /models' }));

    await waitFor(() => {
      expect(api.fetchModelsForLlmProfilePreviewForBackend).toHaveBeenCalledWith('b1', {
        providerType: 'anthropic',
        baseUrl: undefined,
        apiKey: undefined,
        requestHeaders: undefined,
        models: [{ modelId: 'claude-x' }],
      });
    });
    expect(await screen.findByText('Import models from /models')).toBeInTheDocument();
    expect(screen.getByText('claude-new')).toBeInTheDocument();
  });

  it('probe (Test) calls the ForBackend probe preview api with the model id', async () => {
    renderEditor(makeProfile());

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => {
      expect(api.probeLlmProfileModelPreviewForBackend).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({ providerType: 'anthropic' }),
        'claude-x'
      );
    });
    expect(await screen.findByText('✓ 42 ms')).toBeInTheDocument();
  });
});
