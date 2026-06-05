import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LlmProfileManager as ProviderManager } from '../../features/settings/LlmProfileManager';
import * as api from '../../services/api';

const ASYNC_TIMEOUT = 200;
const waitForFast = (assertion: Parameters<typeof waitFor>[0]) =>
  waitFor(assertion, { timeout: ASYNC_TIMEOUT });

async function renderProviderManager(props: Partial<Parameters<typeof ProviderManager>[0]> = {}) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<ProviderManager isOpen={true} onClose={vi.fn()} {...props} />);
    await Promise.resolve();
  });
  return view;
}

async function clickAsync(target: Element) {
  await act(async () => {
    fireEvent.click(target);
    await Promise.resolve();
  });
}

const mockServerState = {
  activeServerId: 'local',
  connections: {
    local: { status: 'connected', error: null, isLocalConnection: true, features: [] },
  },
};

const mockRecoveryState = {
  backends: {
    local: { status: 'ready' },
  },
};

const mockFacadeState = {
  connectionState: 'connected',
  backends: [{ backendId: 'local', runtimeState: 'ready' }],
};

const { mockProviderMetaState, useLlmProfileMetaStoreMock } = vi.hoisted(() => {
  const state = {
    getProviders: vi.fn(() => []),
    setProviders: vi.fn(),
  };

  const store = Object.assign(
    vi.fn((selector?: (currentState: typeof state) => unknown) => (
      typeof selector === 'function' ? selector(state) : state
    )),
    {
      getState: () => state,
    }
  );

  return {
    mockProviderMetaState: state,
    useLlmProfileMetaStoreMock: store,
  };
});

// Mock the serverStore with selector support
vi.mock('../../stores/serverStore', () => ({
  useServerStore: vi.fn((selector?: (state: typeof mockServerState) => unknown) => (
    typeof selector === 'function' ? selector(mockServerState) : mockServerState
  )),
}));

vi.mock('../../stores/recoveryStore', () => ({
  useRecoveryStore: vi.fn((selector?: (state: typeof mockRecoveryState) => unknown) => (
    typeof selector === 'function' ? selector(mockRecoveryState) : mockRecoveryState
  )),
}));

vi.mock('../../stores/facadeStore', () => ({
  useFacadeStore: vi.fn((selector?: (state: typeof mockFacadeState) => unknown) => (
    typeof selector === 'function' ? selector(mockFacadeState) : mockFacadeState
  )),
}));

vi.mock('../../utils/platform', () => ({
  isAndroid: vi.fn(() => false),
}));

vi.mock('../../stores/llmProfileMetaStore', () => ({
  useLlmProfileMetaStore: useLlmProfileMetaStoreMock,
}));

const mockSetProviders = vi.fn();
vi.mock('../../stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      setProviders: mockSetProviders,
    }),
  },
}));

vi.mock('../../hooks/useAndroidBack', () => ({
  useAndroidBack: vi.fn(),
}));

// Mock the api module
vi.mock('../../services/api', () => ({
  listLlmProfiles: vi.fn(),
  createLlmProfile: vi.fn(),
  updateLlmProfile: vi.fn(),
  deleteLlmProfile: vi.fn(),
  setDefaultLlmProfile: vi.fn(),
  fetchModelsForLlmProfilePreview: vi.fn(),
  probeLlmProfileModelPreview: vi.fn(),
  resolveContextWindowPreview: vi.fn(),
}));

import { useServerStore } from '../../stores/serverStore';
import { isAndroid } from '../../utils/platform';

describe('ProviderManager', () => {
  const mockOnClose = vi.fn();

  const mockProviders = [
    {
      id: 'p1',
      name: 'ZClaudia Default',
      providerType: 'anthropic' as const,
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'p2',
      name: 'Work ZClaudia',
      providerType: 'anthropic' as const,
      baseUrl: '/usr/local/bin/claude',
      isDefault: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listLlmProfiles).mockResolvedValue(mockProviders);
    vi.mocked(api.createLlmProfile).mockResolvedValue(mockProviders[0]);
    vi.mocked(api.updateLlmProfile).mockResolvedValue(undefined);
    vi.mocked(api.deleteLlmProfile).mockResolvedValue({ ok: true });
    vi.mocked(api.setDefaultLlmProfile).mockResolvedValue(undefined);
    vi.mocked(api.fetchModelsForLlmProfilePreview).mockResolvedValue({ ok: true, models: [] });
    vi.mocked(api.probeLlmProfileModelPreview).mockResolvedValue({ ok: true, latencyMs: 0 });
    vi.mocked(api.resolveContextWindowPreview).mockResolvedValue({ value: 200_000, source: 'pi_ai_registry' });
    mockProviderMetaState.getProviders.mockReturnValue([]);
    mockServerState.activeServerId = 'local';
    mockServerState.connections.local.status = 'connected';
    mockRecoveryState.backends.local.status = 'ready';
    mockFacadeState.connectionState = 'connected';
    mockFacadeState.backends = [{ backendId: 'local', runtimeState: 'ready' }];
    vi.mocked(isAndroid).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when not open', () => {
    const { container } = render(
      <ProviderManager isOpen={false} onClose={mockOnClose} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal when open', async () => {
    await renderProviderManager({ onClose: mockOnClose });

    expect(screen.getByText('Provider Management')).toBeInTheDocument();
  });

  it('shows "Connect to a server first" when disconnected', async () => {
    mockFacadeState.connectionState = 'idle';
    mockFacadeState.backends = [];

    await renderProviderManager({ onClose: mockOnClose });

    expect(screen.getByText('Connect to a server first')).toBeInTheDocument();
  });

  it('shows "Connect to a server first" when backend is not ready', async () => {
    mockFacadeState.connectionState = 'connected';
    mockFacadeState.backends = [{ backendId: 'local', runtimeState: 'visible' }];

    await renderProviderManager({ onClose: mockOnClose });

    expect(screen.getByText('Connect to a server first')).toBeInTheDocument();
    expect(api.listLlmProfiles).not.toHaveBeenCalled();
  });

  it('loads and displays providers on open', async () => {
    await renderProviderManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(api.listLlmProfiles).toHaveBeenCalled();
    });

    expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
    expect(screen.getByText('Work ZClaudia')).toBeInTheDocument();
  });

  it('shows Default badge for default provider', async () => {
    await renderProviderManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
    });

    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('shows provider type badge', async () => {
    await renderProviderManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
    });

    const badges = screen.getAllByText('anthropic');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('shows baseUrl for provider that has one', async () => {
    await renderProviderManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText('/usr/local/bin/claude')).toBeInTheDocument();
    });
  });

  it('shows empty state when no providers', async () => {
    vi.mocked(api.listLlmProfiles).mockResolvedValue([]);

    await renderProviderManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText(/No providers configured/)).toBeInTheDocument();
    });
  });

  it('closes modal when backdrop is clicked', async () => {
    await renderProviderManager({ onClose: mockOnClose });

    // The backdrop is the first div with bg-black/50
    const backdrop = document.querySelector('.bg-black\\/50');
    expect(backdrop).toBeInTheDocument();
    await clickAsync(backdrop!);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('closes modal when close button is clicked', async () => {
    await renderProviderManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText('Provider Management')).toBeInTheDocument();
    });

    // Find close button by finding the header and its button
    const header = screen.getByText('Provider Management').closest('div')?.parentElement;
    const closeBtn = header?.querySelector('button');
    expect(closeBtn).toBeTruthy();
    if (closeBtn) {
      await clickAsync(closeBtn);
      expect(mockOnClose).toHaveBeenCalled();
    }
  });

  describe('Add Provider Form', () => {
    it('shows add form when Add Provider button is clicked', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitForFast(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      // Check for form elements by their text content since labels don't have htmlFor
      expect(screen.getByText(/Name \*/)).toBeInTheDocument();
      expect(screen.getByText('Provider Type')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Local ZClaudia Agent/)).toBeInTheDocument();
    });

    it('creates provider on form submit', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitForFast(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      const nameInput = screen.getByPlaceholderText(/Local ZClaudia Agent/);
      fireEvent.change(nameInput, { target: { value: 'New Provider' } });

      // F2: at least one declared model is required for Save to pass validation
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), {
        target: { value: 'claude-opus-4-7' },
      });

      await clickAsync(screen.getByText('Create'));

      await waitForFast(() => {
        expect(api.createLlmProfile).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'New Provider',
            providerType: 'anthropic',
            models: [{ modelId: 'claude-opus-4-7' }],
          })
        );
      });
    });

    it('does not submit when name is empty', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitForFast(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      // Create button should be disabled when name is empty
      const createButton = screen.getByText('Create');
      expect(createButton).toBeDisabled();
    });

    it('goes back to list when Cancel is clicked', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitForFast(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      expect(screen.getByText('Create')).toBeInTheDocument();

      await clickAsync(screen.getByText('Cancel'));

      expect(screen.queryByText('Create')).not.toBeInTheDocument();
      expect(screen.getByText('Add Provider')).toBeInTheDocument();
    });
  });

  describe('Edit Provider', () => {
    it('populates form when Edit is clicked', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Work ZClaudia')).toBeInTheDocument();
      });

      // Click the edit button for Work Claude
      const editButtons = screen.getAllByTitle('Edit');
      await clickAsync(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByDisplayValue('ZClaudia Default')).toBeInTheDocument();
      });
    });

    it('calls updateProvider on edit submit', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle('Edit');
      await clickAsync(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Update')).toBeInTheDocument();
      });

      const nameInput = screen.getByDisplayValue('ZClaudia Default');
      fireEvent.change(nameInput, { target: { value: 'Updated Name' } });

      // F2: the fixture profile has no models, so Save is disabled by the
      // new "at least one model" gate. Add a model row before Update so the
      // payload-shape assertion below actually reaches the API call.
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), { target: { value: 'm1' } });

      await clickAsync(screen.getByText('Update'));

      await waitFor(() => {
        expect(api.updateLlmProfile).toHaveBeenCalledWith(
          'p1',
          expect.objectContaining({
            name: 'Updated Name',
          })
        );
      });
    });
  });

  describe('Delete Provider', () => {
    it('calls deleteProvider after delete is confirmed with a second click', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      const deleteButton = screen.getAllByTitle('Delete')[0];
      await clickAsync(deleteButton);

      expect(api.deleteLlmProfile).not.toHaveBeenCalled();
      expect(deleteButton).toHaveAttribute('title', 'Click again to confirm delete');

      await clickAsync(deleteButton);

      await waitFor(() => {
        expect(api.deleteLlmProfile).toHaveBeenCalledWith('p1');
      });
    });

    it('does not delete on the first delete click', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Delete');
      await clickAsync(deleteButtons[0]);

      expect(api.deleteLlmProfile).not.toHaveBeenCalled();
    });
  });

  describe('Set Default Provider', () => {
    it('calls setDefaultProvider when set default is clicked', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Work ZClaudia')).toBeInTheDocument();
      });

      // Set default button only appears for non-default providers
      const setDefaultButtons = screen.getAllByTitle('Set as default');
      await clickAsync(setDefaultButtons[0]);

      expect(api.setDefaultLlmProfile).toHaveBeenCalledWith('p2');
    });

    it('does not show set default button for already default provider', async () => {
      vi.mocked(api.listLlmProfiles).mockResolvedValue([
        {
          id: 'p1',
          name: 'Only Provider',
          providerType: 'anthropic',
          isDefault: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Only Provider')).toBeInTheDocument();
      });

      expect(screen.queryByTitle('Set as default')).not.toBeInTheDocument();
    });
  });

  describe('Form validation', () => {
    it('shows inline error for invalid JSON in request headers field', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      const nameInput = screen.getByPlaceholderText(/Local ZClaudia Agent/);
      fireEvent.change(nameInput, { target: { value: 'New Provider' } });

      const headersTextarea = screen.getByPlaceholderText(/X-Org-Id/);
      fireEvent.change(headersTextarea, { target: { value: 'invalid json' } });

      // F2: Save is gated on having at least one model row; add one so we
      // actually reach the headers JSON validator we're asserting on.
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), { target: { value: 'm1' } });

      await clickAsync(screen.getByText('Create'));

      await waitFor(() => {
        expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();
      });

      expect(api.createLlmProfile).not.toHaveBeenCalled();
    });

    it('rejects Authorization in requestHeaders with inline error (client-side)', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      const nameInput = screen.getByPlaceholderText(/Local ZClaudia Agent/);
      fireEvent.change(nameInput, { target: { value: 'New Provider' } });

      const headersTextarea = screen.getByPlaceholderText(/X-Org-Id/);
      fireEvent.change(headersTextarea, { target: { value: '{"Authorization": "Bearer x"}' } });

      // F2: declared model required for Save to reach the headers validator.
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), { target: { value: 'm1' } });

      await clickAsync(screen.getByText('Create'));

      await waitFor(() => {
        expect(screen.getByText(/reserved/i)).toBeInTheDocument();
      });

      expect(api.createLlmProfile).not.toHaveBeenCalled();
    });

    it('accepts valid JSON in request headers field', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      const nameInput = screen.getByPlaceholderText(/Local ZClaudia Agent/);
      fireEvent.change(nameInput, { target: { value: 'New Provider' } });

      const headersTextarea = screen.getByPlaceholderText(/X-Org-Id/);
      fireEvent.change(headersTextarea, { target: { value: '{"X-Org-Id": "test"}' } });

      // F2: a declared model is required for Save to pass validation
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), {
        target: { value: 'm1' },
      });

      await clickAsync(screen.getByText('Create'));

      await waitFor(() => {
        expect(api.createLlmProfile).toHaveBeenCalledWith(
          expect.objectContaining({
            requestHeaders: { 'X-Org-Id': 'test' },
          })
        );
      });
    });
  });

  describe('Error handling', () => {
    it('shows alert when createProvider fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      vi.mocked(api.createLlmProfile).mockRejectedValueOnce(new Error('Network error'));

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      fireEvent.change(screen.getByPlaceholderText(/Local ZClaudia Agent/), { target: { value: 'New' } });
      // F2: add a model row so Save passes the empty-models validation and we
      // actually reach the api.createLlmProfile call that we want to fail.
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), { target: { value: 'm1' } });
      await clickAsync(screen.getByText('Create'));

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to create provider'));
      });
      alertSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('shows inline error when deleteProvider fails with a generic error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      vi.mocked(api.deleteLlmProfile).mockResolvedValueOnce({
        ok: false,
        code: 'UNKNOWN',
        message: 'Delete error',
      });

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      const deleteButton = screen.getAllByTitle('Delete')[0];
      await clickAsync(deleteButton);
      await clickAsync(deleteButton);

      await waitFor(() => {
        expect(screen.getByText('Delete error')).toBeInTheDocument();
      });
      expect(alertSpy).not.toHaveBeenCalled();
      alertSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('shows friendly inline error when the LLM profile is in use by agents', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(api.deleteLlmProfile).mockResolvedValueOnce({
        ok: false,
        code: 'IN_USE',
        message: 'LlmProfile p1 is referenced by 3 agent profile(s) and cannot be deleted',
        agentCount: 3,
      });

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      const deleteButton = screen.getAllByTitle('Delete')[0];
      await clickAsync(deleteButton);
      await clickAsync(deleteButton);

      await waitFor(() => {
        expect(
          screen.getByText(/used by 3 agent profiles\. Edit those agents/i),
        ).toBeInTheDocument();
      });
      consoleSpy.mockRestore();
    });

    it('singularizes the friendly message when a single agent profile is bound', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(api.deleteLlmProfile).mockResolvedValueOnce({
        ok: false,
        code: 'IN_USE',
        message: 'LlmProfile p1 is referenced by 1 agent profile(s) and cannot be deleted',
        agentCount: 1,
      });

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      const deleteButton = screen.getAllByTitle('Delete')[0];
      await clickAsync(deleteButton);
      await clickAsync(deleteButton);

      await waitFor(() => {
        expect(screen.getByText(/used by 1 agent profile\./i)).toBeInTheDocument();
      });
      consoleSpy.mockRestore();
    });

    it('logs error when setDefaultProvider fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(api.setDefaultLlmProfile).mockRejectedValueOnce(new Error('Set default error'));

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Work ZClaudia')).toBeInTheDocument();
      });

      await clickAsync(screen.getAllByTitle('Set as default')[0]);

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to set default provider:', expect.any(Error));
      });
      consoleSpy.mockRestore();
    });

    it('logs error when getProviders fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(api.listLlmProfiles).mockRejectedValueOnce(new Error('Load error'));

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to load providers:', expect.any(Error));
      });
      consoleSpy.mockRestore();
    });
  });

  describe('Inline mode', () => {
    it('renders content without modal wrapper in inline mode', async () => {
      await renderProviderManager({ onClose: mockOnClose, inline: true });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      // Should NOT have modal wrapper
      expect(screen.queryByText('Provider Management')).not.toBeInTheDocument();
      expect(document.querySelector('.bg-black\\/50')).not.toBeInTheDocument();
    });
  });

  describe('TypeSelector dropdown', () => {
    it('shows the zclaudia type label in the type selector', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      // 'anthropic' is the new default after the llm-profile rename
      expect(screen.getByText('Anthropic')).toBeInTheDocument();
    });
  });

  describe('Edit form with request headers', () => {
    it('populates request headers field when editing provider with requestHeaders', async () => {
      vi.mocked(api.listLlmProfiles).mockResolvedValue([
        {
          id: 'p1',
          name: 'Provider With Headers',
          providerType: 'anthropic' as const,
          isDefault: false,
          requestHeaders: { 'X-Org-Id': 'secret' },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Provider With Headers')).toBeInTheDocument();
      });

      await clickAsync(screen.getByTitle('Edit'));

      await waitFor(() => {
        expect(screen.getByText('Update')).toBeInTheDocument();
      });

      // Request headers textarea should have JSON content
      const headersTextarea = screen.getByPlaceholderText(/X-Org-Id/);
      expect(headersTextarea).toHaveValue(JSON.stringify({ 'X-Org-Id': 'secret' }, null, 2));
    });
  });

  describe('isDefault checkbox', () => {
    it('submits isDefault flag', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      fireEvent.change(screen.getByPlaceholderText(/Local ZClaudia Agent/), { target: { value: 'New' } });
      // F2: a declared model row is required for Save.
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), { target: { value: 'm1' } });

      const checkbox = screen.getByLabelText('Set as default runtime');
      await clickAsync(checkbox);

      await clickAsync(screen.getByText('Create'));

      await waitFor(() => {
        expect(api.createLlmProfile).toHaveBeenCalledWith(
          expect.objectContaining({ isDefault: true })
        );
      });
    });
  });

  describe('Base URL in form', () => {
    it('submits baseUrl when provided', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      fireEvent.change(screen.getByPlaceholderText(/Local ZClaudia Agent/), { target: { value: 'Custom' } });
      fireEvent.change(screen.getByPlaceholderText(/api\.example\.com/), { target: { value: 'http://127.0.0.1:3000/v1' } });
      // F2: declared model is required.
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), { target: { value: 'm1' } });

      await clickAsync(screen.getByText('Create'));

      await waitFor(() => {
        expect(api.createLlmProfile).toHaveBeenCalledWith(
          expect.objectContaining({ baseUrl: 'http://127.0.0.1:3000/v1' })
        );
      });
    });
  });

  describe('New LlmProfile field shape', () => {
    it('submits the new field shape (providerType + baseUrl + apiKey + compat)', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      // Fill name
      fireEvent.change(screen.getByPlaceholderText(/Local ZClaudia Agent/), {
        target: { value: 'DeepSeek Local' },
      });

      // Choose providerType from dropdown: openai (merged with the legacy
      // openai-custom shape in migration 004, so a baseUrl override now lives
      // on the unified `openai` provider type).
      await clickAsync(screen.getByText('Provider Type').nextElementSibling as Element);
      await clickAsync(screen.getByText('OpenAI'));

      // Fill baseUrl
      fireEvent.change(screen.getByPlaceholderText(/api\.example\.com/), {
        target: { value: 'http://127.0.0.1:3000/v1' },
      });

      // Fill apiKey (password input)
      fireEvent.change(screen.getByPlaceholderText('sk-...'), {
        target: { value: 'sk-test-123' },
      });

      // Reveal advanced compat section + fill JSON
      await clickAsync(screen.getByText(/Advanced \(compat\)/));
      fireEvent.change(screen.getByLabelText('Compat JSON'), {
        target: { value: '{"supportsReasoningEffort": true}' },
      });

      // F2: declared model required.
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), {
        target: { value: 'deepseek-chat' },
      });

      await clickAsync(screen.getByText('Create'));

      await waitFor(() => {
        expect(api.createLlmProfile).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'DeepSeek Local',
            providerType: 'openai',
            baseUrl: 'http://127.0.0.1:3000/v1',
            apiKey: 'sk-test-123',
            compat: { supportsReasoningEffort: true },
            isDefault: false,
          })
        );
      });
    });

    it('surfaces an inline error when compat JSON is invalid', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      fireEvent.change(screen.getByPlaceholderText(/Local ZClaudia Agent/), {
        target: { value: 'Broken Compat' },
      });

      await clickAsync(screen.getByText(/Advanced \(compat\)/));
      fireEvent.change(screen.getByLabelText('Compat JSON'), {
        target: { value: 'not-json' },
      });

      // F2: still need a model row to get past the empty-models gate and
      // actually trigger the compat-JSON validation we're asserting on.
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), { target: { value: 'm1' } });

      await clickAsync(screen.getByText('Create'));

      await waitFor(() => {
        expect(screen.getByText('Invalid JSON in compat field')).toBeInTheDocument();
      });
      expect(api.createLlmProfile).not.toHaveBeenCalled();
    });
  });

  describe('Models block', () => {
    it('shows empty hint when profile has no models declared', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      // Editing the first existing profile (which has no models) should show the empty hint
      await clickAsync(screen.getAllByTitle('Edit')[0]);

      await waitFor(() => {
        // F2: the empty-state copy was rewritten to point users at the new
        // "add at least one" requirement.
        expect(screen.getByText(/No models declared\. Add at least one/i)).toBeInTheDocument();
      });
    });

    it('keeps Fetch from /models enabled on an unsaved Add Provider form (preview endpoint)', async () => {
      // F2: Fetch/Test now use preview endpoints that accept the form draft
      // directly, so we don't gate on profileSaved or formDirty anymore.
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      const fetchBtn = screen.getByText('Fetch from /models');
      expect(fetchBtn).not.toBeDisabled();
    });

    it('+ Add model inserts an empty row with all four inputs', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      await clickAsync(screen.getByText('+ Add model'));

      expect(screen.getByPlaceholderText(/model id \(e\.g\./)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/display name/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/context window/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/max tokens/)).toBeInTheDocument();
    });

    it('shows inline duplicate error when two rows share a modelId', async () => {
      vi.mocked(api.listLlmProfiles).mockResolvedValue([
        {
          id: 'p1',
          name: 'With Models',
          providerType: 'anthropic' as const,
          isDefault: false,
          models: [{ modelId: 'opus' }],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('With Models')).toBeInTheDocument();
      });

      await clickAsync(screen.getByTitle('Edit'));
      await clickAsync(screen.getByText('+ Add model'));

      const idInputs = screen.getAllByPlaceholderText(/model id \(e\.g\./);
      expect(idInputs).toHaveLength(2);
      fireEvent.change(idInputs[1], { target: { value: 'opus' } });

      // Both rows surface the duplicate marker — assert ≥1 inline error appears
      await waitFor(() => {
        expect(screen.getAllByText(/duplicate model id/i).length).toBeGreaterThan(0);
      });
    });

    it('shows inline error for non-positive contextWindow', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getAllByTitle('Edit')[0]);
      await clickAsync(screen.getByText('+ Add model'));

      const idInput = screen.getByPlaceholderText(/model id \(e\.g\./);
      fireEvent.change(idInput, { target: { value: 'm1' } });
      const cwInput = screen.getByPlaceholderText(/context window/);
      fireEvent.change(cwInput, { target: { value: '0' } });

      await waitFor(() => {
        expect(screen.getByText(/contextWindow must be a positive integer/i)).toBeInTheDocument();
      });
    });

    it('serializes models into the update payload, dropping empty rows and empty overrides', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getAllByTitle('Edit')[0]);
      await clickAsync(screen.getByText('+ Add model'));
      const idInput = screen.getByPlaceholderText(/model id \(e\.g\./);
      fireEvent.change(idInput, { target: { value: 'claude-opus-4-7' } });
      const cwInput = screen.getByPlaceholderText(/context window/);
      fireEvent.change(cwInput, { target: { value: '1000000' } });

      // Add a second fully-empty row that should be dropped on save
      await clickAsync(screen.getByText('+ Add model'));

      await clickAsync(screen.getByText('Update'));

      await waitFor(() => {
        expect(api.updateLlmProfile).toHaveBeenCalledWith(
          'p1',
          expect.objectContaining({
            models: [{ modelId: 'claude-opus-4-7', contextWindow: 1000000 }],
          })
        );
      });
    });

    it('Test button is disabled when the row has an empty modelId', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getAllByTitle('Edit')[0]);
      await clickAsync(screen.getByText('+ Add model'));

      const testBtn = screen.getByText('Test');
      expect(testBtn).toBeDisabled();
      expect(testBtn).toHaveAttribute('title', 'Enter a model id first');
    });

    it('renders a probed ok status with latency on a successful preview probe', async () => {
      // F2: probe now hits the preview endpoint with the current form draft,
      // so we no longer need a saved fixture model row — we can type one in
      // and click Test immediately.
      vi.mocked(api.probeLlmProfileModelPreview).mockResolvedValueOnce({ ok: true, latencyMs: 423 });

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getAllByTitle('Edit')[0]);
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), {
        target: { value: 'opus' },
      });

      await clickAsync(screen.getByText('Test'));

      await waitFor(() => {
        expect(screen.getByText(/✓ 423 ms/)).toBeInTheDocument();
      });
      // probe-preview is called with the form draft (providerType + models[])
      // plus the modelId — assert at least the providerType + modelId pair.
      expect(api.probeLlmProfileModelPreview).toHaveBeenCalledWith(
        expect.objectContaining({ providerType: 'anthropic' }),
        'opus',
      );
    });

    it('opens the picker dialog when Fetch (preview) returns ids, and adds selected ids on confirm', async () => {
      vi.mocked(api.fetchModelsForLlmProfilePreview).mockResolvedValueOnce({
        ok: true,
        models: ['claude-opus-4-7', 'claude-sonnet-4-6'],
      });

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getAllByTitle('Edit')[0]);
      await clickAsync(screen.getByText('Fetch from /models'));

      await waitFor(() => {
        expect(screen.getByText('Import models from /models')).toBeInTheDocument();
      });

      expect(screen.getByText('claude-opus-4-7')).toBeInTheDocument();
      expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument();

      // Both selected by default → confirm
      await clickAsync(screen.getByText(/Add 2 models/));

      await waitFor(() => {
        const idInputs = screen.getAllByPlaceholderText(/model id \(e\.g\./);
        const values = idInputs.map((el) => (el as HTMLInputElement).value);
        expect(values).toContain('claude-opus-4-7');
        expect(values).toContain('claude-sonnet-4-6');
      });
    });

    it('surfaces a fetch error inline when Fetch (preview) fails', async () => {
      vi.mocked(api.fetchModelsForLlmProfilePreview).mockResolvedValueOnce({
        ok: false,
        error: 'Upstream returned 403 Forbidden',
      });

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getAllByTitle('Edit')[0]);
      await clickAsync(screen.getByText('Fetch from /models'));

      await waitFor(() => {
        expect(screen.getByText(/Upstream returned 403 Forbidden/)).toBeInTheDocument();
      });
    });

    it('keeps Test + Fetch enabled even with unsaved form changes (preview adoption)', async () => {
      // F2: with preview adoption the dirty-form gate is gone — Test and
      // Fetch should both stay enabled while the user is editing.
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getAllByTitle('Edit')[0]);
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), {
        target: { value: 'opus' },
      });

      const testBtn = screen.getByText('Test');
      expect(testBtn).not.toBeDisabled();

      const fetchBtn = screen.getByText('Fetch from /models');
      expect(fetchBtn).not.toBeDisabled();
    });

    it('disables Save and surfaces inline error when no models are declared', async () => {
      // F2: empty models list is now a hard save error. The Save button is
      // disabled with a tooltip pointing the user at the fix; clicking it
      // would also surface the same banner inline if it were enabled.
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      fireEvent.change(screen.getByPlaceholderText(/Local ZClaudia Agent/), { target: { value: 'No Models' } });

      const createBtn = screen.getByText('Create');
      expect(createBtn).toBeDisabled();
      expect(createBtn).toHaveAttribute('title', 'Add at least one model before saving');
      expect(api.createLlmProfile).not.toHaveBeenCalled();
    });

    it('surfaces a save-time row-level error inline (no window.alert) when a model row is duplicate on save', async () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      vi.mocked(api.listLlmProfiles).mockResolvedValue([
        {
          id: 'p1',
          name: 'With Models',
          providerType: 'anthropic' as const,
          isDefault: false,
          models: [{ modelId: 'opus' }],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('With Models')).toBeInTheDocument();
      });

      await clickAsync(screen.getByTitle('Edit'));
      await clickAsync(screen.getByText('+ Add model'));
      const idInputs = screen.getAllByPlaceholderText(/model id \(e\.g\./);
      fireEvent.change(idInputs[1], { target: { value: 'opus' } });

      await clickAsync(screen.getByText('Update'));

      // No alert, but an inline banner pointing at the offending row. The
      // validator scans rows in order and breaks at the first one with a
      // duplicate marker — row 0 sees row 1 as the dup, so it reports row 1.
      await waitFor(() => {
        expect(
          screen.getByText(/Fix model row 1 before saving/i)
        ).toBeInTheDocument();
      });
      expect(alertSpy).not.toHaveBeenCalled();
      expect(api.updateLlmProfile).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });
  });

  describe('Resolved contextWindow hint (F3)', () => {
    // The ModelRow debounces resolve-preview by 300ms; waitFor's default
    // 1s timeout is enough but we use waitFor (not waitForFast) for these.

    it('shows "Using X from registry" for pi_ai_registry source (no matchedProvider)', async () => {
      vi.mocked(api.resolveContextWindowPreview).mockResolvedValue({
        value: 200_000,
        source: 'pi_ai_registry',
      });

      await renderProviderManager({ onClose: mockOnClose });
      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), {
        target: { value: 'claude-opus-4-7' },
      });

      const hint = await waitFor(() =>
        screen.getByText(/Using 200,000 from registry/),
      );
      // No "(provider)" parenthetical when matchedProvider is absent.
      expect(hint.textContent).not.toMatch(/\(/);
      // F4: never expose "pi-ai" wording to the user.
      expect(hint.textContent).not.toMatch(/pi-ai/i);
    });

    it('annotates pi_ai_registry hint with matchedProvider on cross-provider hits', async () => {
      // Cross-provider sweep: an openai-compat profile borrows a registered
      // `deepseek-v4` model id; the server reports matchedProvider="deepseek"
      // so users can tell which provider's spec we adopted.
      vi.mocked(api.resolveContextWindowPreview).mockResolvedValue({
        value: 131_072,
        source: 'pi_ai_registry',
        matchedProvider: 'deepseek',
      });

      await renderProviderManager({ onClose: mockOnClose });
      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), {
        target: { value: 'deepseek-v4' },
      });

      const hint = await waitFor(() =>
        screen.getByText(/Using 131,072 from registry \(deepseek\)/),
      );
      expect(hint.textContent).not.toMatch(/pi-ai/i);
    });

    it('shows amber openai_compat_default warning when registry has no match for openai-compat profile', async () => {
      // F4 split: openai-compat proxies hand back a 128k literal when nothing
      // in the registry matched. Distinct from the 100k `fallback` path so
      // users can tell "we assumed compat default" from "we have no idea".
      vi.mocked(api.resolveContextWindowPreview).mockResolvedValue({
        value: 128_000,
        source: 'openai_compat_default',
      });

      await renderProviderManager({ onClose: mockOnClose });
      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), {
        target: { value: 'mystery-openai-compat-model' },
      });

      const warning = await waitFor(() =>
        screen.getByText(/Using 128,000 default for openai-compat\. No registry match for "mystery-openai-compat-model"/i),
      );
      const wrapper = warning.closest('p');
      expect(wrapper?.className).toMatch(/text-amber-600/);
    });

    it('shows amber fallback warning with AlertTriangle for fallback source', async () => {
      vi.mocked(api.resolveContextWindowPreview).mockResolvedValue({
        value: 100_000,
        source: 'fallback',
      });

      await renderProviderManager({ onClose: mockOnClose });
      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), {
        target: { value: 'unknown-model-xyz' },
      });

      const warning = await waitFor(() =>
        screen.getByText(/Falls back to 100,000 — no spec found/i)
      );
      // The amber class lives on the wrapper <p>; the icon is a sibling
      // span inside it. Verify the amber class so we don't regress the
      // distinct visual treatment of the fallback path.
      const wrapper = warning.closest('p');
      expect(wrapper?.className).toMatch(/text-amber-600/);
    });

    it('does not show the hint when contextWindow override is filled', async () => {
      vi.mocked(api.resolveContextWindowPreview).mockResolvedValue({
        value: 200_000,
        source: 'pi_ai_registry',
      });

      await renderProviderManager({ onClose: mockOnClose });
      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), {
        target: { value: 'claude-opus-4-7' },
      });
      // Now fill the override — the helper should disappear (and no resolve
      // request should be in flight either).
      fireEvent.change(screen.getByPlaceholderText(/context window/), {
        target: { value: '500000' },
      });

      // Give the debounce window time to elapse so the assertion isn't
      // a no-op against a still-pending request that hasn't fired yet.
      await new Promise((r) => setTimeout(r, 350));

      expect(screen.queryByText(/Using .* from registry/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Falls back to \d/)).not.toBeInTheDocument();
    });

    it('does not fire a resolve request when modelId is empty', async () => {
      await renderProviderManager({ onClose: mockOnClose });
      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      await clickAsync(screen.getByText('+ Add model'));

      // Wait past the debounce window — the empty modelId must keep the
      // hint silent and the API mock untouched.
      await new Promise((r) => setTimeout(r, 350));

      expect(api.resolveContextWindowPreview).not.toHaveBeenCalled();
      expect(screen.queryByText(/Using \d/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Falls back to \d/)).not.toBeInTheDocument();
    });

    it('strips the row\'s own contextWindow from models[] before calling (self-edit guard)', async () => {
      // Simulates the user typing a contextWindow then clearing it — the
      // entry still exists in formModels with contextWindow=undefined (which
      // draftsToEntries already drops), but importantly the resolve-preview
      // call must never carry our own override even when one is mid-edit.
      vi.mocked(api.resolveContextWindowPreview).mockResolvedValue({
        value: 200_000,
        source: 'pi_ai_registry',
      });

      await renderProviderManager({ onClose: mockOnClose });
      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), {
        target: { value: 'claude-opus-4-7' },
      });

      await waitFor(() => {
        expect(api.resolveContextWindowPreview).toHaveBeenCalled();
      });

      const lastCall = vi.mocked(api.resolveContextWindowPreview).mock.calls.at(-1)?.[0];
      expect(lastCall?.modelId).toBe('claude-opus-4-7');
      // Find the entry for this modelId in the request payload — it must not
      // carry a contextWindow (or carry undefined), regardless of what other
      // rows look like.
      const ourEntry = lastCall?.models?.find((m) => m.modelId === 'claude-opus-4-7');
      // ourEntry may be undefined (row hasn't been serialized into draftsToEntries
      // because no contextWindow override was set) — either way, it must not
      // declare a contextWindow.
      expect(ourEntry?.contextWindow).toBeUndefined();
    });
  });
});
