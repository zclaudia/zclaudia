// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

interface CapturedCodexSectionProps {
  backendId: string;
  onBeforeSignIn?: () => Promise<LlmProfileConfig | null>;
  onCredentialsChanged: () => void;
}

const captured = vi.hoisted(() => ({
  codexSection: null as unknown,
}));

vi.mock('../CodexOAuthSection', () => ({
  CodexOAuthSection: (props: { backendId: string }) => {
    captured.codexSection = props;
    return <div data-testid="codex-oauth-section">{props.backendId}</div>;
  },
}));

function capturedCodexSectionProps(): CapturedCodexSectionProps {
  expect(captured.codexSection).not.toBeNull();
  return captured.codexSection as CapturedCodexSectionProps;
}

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
  const onBack = vi.fn();
  const view = render(
    <LlmProfileEditor
      backendId="b1"
      backendName="Backend 1"
      profile={profile}
      onBack={onBack}
      onSaved={onSaved}
    />
  );
  return { onSaved, onBack, ...view };
}

describe('LlmProfileEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.codexSection = null;
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
    vi.useFakeTimers();
    try {
      const { onSaved } = renderEditor(null);

      fireEvent.change(screen.getByPlaceholderText('e.g., Local ZClaudia Agent'), {
        target: { value: 'My Provider' },
      });
      fireEvent.click(screen.getByRole('tab', { name: /Models/ }));
      fireEvent.click(screen.getByRole('button', { name: '+ Add model' }));
      fireEvent.change(screen.getByLabelText('model id'), { target: { value: 'claude-x' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

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
      expect(onSaved).toHaveBeenCalledWith('created-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('create mode: no model rows remains pending (F2 hard gate)', () => {
    renderEditor(null);

    fireEvent.change(screen.getByPlaceholderText('e.g., Local ZClaudia Agent'), {
      target: { value: 'My Provider' },
    });

    expect(screen.getByTestId('save-state')).toHaveTextContent('Not saved');
    expect(api.createLlmProfileForBackend).not.toHaveBeenCalled();
  });

  it('edit mode: populates the form and updates via updateLlmProfileForBackend', async () => {
    vi.useFakeTimers();
    try {
      const { onSaved } = renderEditor(makeProfile());

      fireEvent.change(screen.getByDisplayValue('My Anthropic'), {
        target: { value: 'Renamed' },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

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
      expect(onSaved).toHaveBeenCalledWith('p1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('autosaves profile changes without rendering a Save button', async () => {
    vi.useFakeTimers();
    try {
      const { onSaved } = renderEditor(makeProfile());

      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
      fireEvent.change(screen.getByDisplayValue('My Anthropic'), {
        target: { value: 'Renamed automatically' },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(api.updateLlmProfileForBackend).toHaveBeenCalledWith(
        'b1',
        'p1',
        expect.objectContaining({ name: 'Renamed automatically' })
      );
      expect(onSaved).toHaveBeenCalledWith('p1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('edit mode: reserved request header blocks save with an inline error', async () => {
    vi.useFakeTimers();
    try {
      const { onSaved } = renderEditor(makeProfile());

      fireEvent.click(screen.getByRole('tab', { name: /Advanced/ }));
      fireEvent.change(screen.getByPlaceholderText(/X-Org-Id/), {
        target: { value: '{"Authorization": "Bearer x"}' },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(
        screen.getByText(
        'Header "Authorization" is reserved (managed by API key); remove it from Request Headers'
        )
      ).toBeInTheDocument();
      expect(api.updateLlmProfileForBackend).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('edit mode: shows an inline error when save fails (no alert)', async () => {
    vi.mocked(api.updateLlmProfileForBackend).mockRejectedValue(new Error('save boom'));
    vi.useFakeTimers();
    try {
      const { onSaved } = renderEditor(makeProfile());
      fireEvent.change(screen.getByDisplayValue('My Anthropic'), { target: { value: 'Renamed' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(screen.getByText('Failed to update provider: save boom')).toBeInTheDocument();
      expect(onSaved).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // Delete / set-default moved to the library card (see AgentsContent) — the
  // editor no longer renders those controls. A default profile surfaces a
  // "Default" badge in its ProfileHeader instead.
  it('renders a Default badge in the header and no in-editor delete/set-default controls', () => {
    renderEditor(makeProfile({ isDefault: true }));

    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set default' })).toBeNull();
  });

  it('splits fields across Connection / Models / Advanced tabs', () => {
    renderEditor(makeProfile());

    // Connection is the default tab: Base URL is visible, model rows are not.
    expect(screen.getByPlaceholderText('http://api.example.com/v1')).toBeInTheDocument();
    expect(screen.queryByLabelText('model id')).toBeNull();
    expect(screen.queryByPlaceholderText(/X-Org-Id/)).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Models/ }));
    expect(screen.getByLabelText('model id')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('http://api.example.com/v1')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Advanced/ }));
    expect(screen.getByPlaceholderText(/X-Org-Id/)).toBeInTheDocument();
    expect(screen.getByLabelText('Compat JSON')).toBeInTheDocument();
  });

  it('openai-codex profile hides the tab bar and shows the OAuth section', () => {
    renderEditor(makeProfile({ providerType: 'openai-codex', models: [] }));
    expect(screen.queryByRole('tab', { name: /Models/ })).toBeNull();
    expect(screen.getByTestId('codex-oauth-section')).toHaveTextContent('b1');
  });

  it('openai-codex profile hides baseUrl/apiKey inputs and shows the OAuth section', () => {
    renderEditor(makeProfile({ providerType: 'openai-codex', models: [] }));

    expect(screen.queryByPlaceholderText('http://api.example.com/v1')).toBeNull();
    expect(screen.queryByPlaceholderText('sk-...')).toBeNull();
    expect(screen.getByTestId('codex-oauth-section')).toHaveTextContent('b1');
  });

  it('shows prompt cache retention only for Anthropic providers', () => {
    renderEditor(makeProfile({ providerType: 'openai' }));
    expect(screen.queryByLabelText('Prompt cache retention')).toBeNull();

    renderEditor(makeProfile({ providerType: 'anthropic' }));
    expect(screen.getByLabelText('Prompt cache retention')).toBeInTheDocument();
  });

  it('codex create: onBeforeSignIn persists silently and later autosaves update (no double create)', async () => {
    vi.mocked(api.updateLlmProfileForBackend).mockResolvedValue(
      makeProfile({ id: 'created-1', providerType: 'openai-codex' })
    );
    const { onSaved } = renderEditor(null);

    fireEvent.change(screen.getByPlaceholderText('e.g., Local ZClaudia Agent'), {
      target: { value: 'My Codex' },
    });
    // Switch the provider type dropdown to openai-codex. The trigger keeps
    // its implicit button role; the popup items are listbox options.
    fireEvent.click(screen.getByRole('button', { name: 'Anthropic' }));
    fireEvent.click(screen.getByRole('option', { name: 'OpenAI Codex (ChatGPT Plus/Pro)' }));

    // Sign-in pre-save: persists via create, resolves with the saved profile,
    // but does NOT notify the parent (a keyed remount would tear down the
    // in-flight OAuth modal).
    let saved: LlmProfileConfig | null = null;
    await act(async () => {
      saved = await capturedCodexSectionProps().onBeforeSignIn!();
    });
    expect(saved).toMatchObject({ id: 'created-1' });
    expect(api.createLlmProfileForBackend).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();

    // The silent create promoted savedIdRef: a subsequent edit updates the
    // persisted profile instead of creating a duplicate.
    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText('e.g., Local ZClaudia Agent'), {
      target: { value: 'My Codex Renamed' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    vi.useRealTimers();
    await waitFor(() => {
      expect(api.updateLlmProfileForBackend).toHaveBeenCalledWith(
        'b1',
        'created-1',
        expect.objectContaining({ name: 'My Codex Renamed', providerType: 'openai-codex' })
      );
    });
    expect(api.createLlmProfileForBackend).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('created-1');
    });

    // Credential changes surface the promoted id to the parent.
    onSaved.mockClear();
    act(() => capturedCodexSectionProps().onCredentialsChanged());
    expect(onSaved).toHaveBeenCalledWith('created-1');
  });

  it('fetch models calls the ForBackend preview api with the form draft and opens the picker', async () => {
    renderEditor(makeProfile());

    fireEvent.click(screen.getByRole('tab', { name: /Models/ }));
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

  it('labels connection fields and exposes provider selector as a combobox', () => {
    renderEditor(makeProfile({ providerType: 'my-custom-provider' }));

    expect(screen.getByLabelText(/base url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();

    // Query by the exact trigger text (the raw providerType, since this
    // custom provider has no display label) rather than a loose /provider/i
    // match — the header breadcrumb ("LLM Providers") also matches that.
    const providerTrigger = screen.getByRole('button', { name: 'my-custom-provider' });
    expect(providerTrigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(providerTrigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('probe (Test) calls the ForBackend probe preview api with the model id', async () => {
    renderEditor(makeProfile());

    fireEvent.click(screen.getByRole('tab', { name: /Models/ }));
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
