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
  fetchModelsForLlmProfile: vi.fn(),
  probeLlmProfileModel: vi.fn(),
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
    vi.mocked(api.deleteLlmProfile).mockResolvedValue(undefined);
    vi.mocked(api.setDefaultLlmProfile).mockResolvedValue(undefined);
    vi.mocked(api.fetchModelsForLlmProfile).mockResolvedValue({ ok: true, models: [] });
    vi.mocked(api.probeLlmProfileModel).mockResolvedValue({ ok: true, latencyMs: 0 });
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

      await clickAsync(screen.getByText('Create'));

      await waitForFast(() => {
        expect(api.createLlmProfile).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'New Provider',
            providerType: 'anthropic',
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
      await clickAsync(screen.getByText('Create'));

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to create provider'));
      });
      alertSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('shows alert when deleteProvider fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      vi.mocked(api.deleteLlmProfile).mockRejectedValueOnce(new Error('Delete error'));

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      const deleteButton = screen.getAllByTitle('Delete')[0];
      await clickAsync(deleteButton);
      await clickAsync(deleteButton);

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to delete provider'));
      });
      alertSpy.mockRestore();
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

      // Choose providerType from dropdown: open it, pick openai-custom
      await clickAsync(screen.getByText('Provider Type').nextElementSibling as Element);
      await clickAsync(screen.getByText('OpenAI-compatible (custom)'));

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

      await clickAsync(screen.getByText('Create'));

      await waitFor(() => {
        expect(api.createLlmProfile).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'DeepSeek Local',
            providerType: 'openai-custom',
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
        expect(screen.getByText(/No models declared/i)).toBeInTheDocument();
      });
    });

    it('disables Fetch from /models for an unsaved (just-opened) Add Provider form', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      const fetchBtn = screen.getByText('Fetch from /models');
      expect(fetchBtn).toBeDisabled();
      expect(fetchBtn).toHaveAttribute('title', 'Save the profile first to fetch models');
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

    it('renders a probed ok status with latency on a successful probe', async () => {
      // Probe requires profileSaved && !formDirty — load a fixture that already
      // has a model row so we can click Test without touching the form (which
      // would mark it dirty and disable Test per the T5 follow-up).
      vi.mocked(api.listLlmProfiles).mockResolvedValue([
        {
          id: 'p1',
          name: 'With Saved Model',
          providerType: 'anthropic' as const,
          isDefault: false,
          models: [{ modelId: 'opus' }],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);
      vi.mocked(api.probeLlmProfileModel).mockResolvedValueOnce({ ok: true, latencyMs: 423 });

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('With Saved Model')).toBeInTheDocument();
      });

      await clickAsync(screen.getByTitle('Edit'));

      await clickAsync(screen.getByText('Test'));

      await waitFor(() => {
        expect(screen.getByText(/✓ 423 ms/)).toBeInTheDocument();
      });
      expect(api.probeLlmProfileModel).toHaveBeenCalledWith('p1', 'opus');
    });

    it('opens the picker dialog when Fetch returns ids, and adds selected ids on confirm', async () => {
      vi.mocked(api.fetchModelsForLlmProfile).mockResolvedValueOnce({
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

    it('surfaces a fetch error inline when Fetch from /models fails', async () => {
      vi.mocked(api.fetchModelsForLlmProfile).mockResolvedValueOnce({
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

    it('disables Test + Fetch when the form is dirty (unsaved changes), with a save-first tooltip', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('ZClaudia Default')).toBeInTheDocument();
      });

      // Edit an existing saved profile → profileSaved=true, formDirty=false.
      await clickAsync(screen.getAllByTitle('Edit')[0]);
      await clickAsync(screen.getByText('+ Add model'));
      fireEvent.change(screen.getByPlaceholderText(/model id \(e\.g\./), {
        target: { value: 'opus' },
      });

      // Adding a row mutates the model draft list — formDirty is now true.
      const testBtn = screen.getByText('Test');
      expect(testBtn).toBeDisabled();
      expect(testBtn).toHaveAttribute(
        'title',
        'Save the profile first to test models with the latest config'
      );

      const fetchBtn = screen.getByText('Fetch from /models');
      expect(fetchBtn).toBeDisabled();
      expect(fetchBtn).toHaveAttribute(
        'title',
        'Save the profile first to fetch models with the latest config'
      );
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
});
