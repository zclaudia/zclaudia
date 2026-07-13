// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AgentProfileConfig, LlmProfileConfig } from '@zclaudia/shared';
import { NewAgentProfileModal } from '../NewAgentProfileModal';
import * as api from '../../../services/api';
import { useRuntimeDescriptorStore } from '../../../stores/runtimeDescriptorStore';

vi.mock('../../../services/api', () => ({
  listLlmProfilesForBackend: vi.fn(),
  createAgentProfileForBackend: vi.fn(),
}));

const RUNTIME_DESCRIPTORS = [
  {
    runtime: 'zclaudia',
    label: 'ZClaudia',
    enabled: true,
    model: {
      kind: 'llm-profile' as const,
      multimodalFallback: true,
      thinkingLevel: 'selectable' as const,
    },
    hasCliPath: false,
    capabilities: {
      tools: 'profile' as const,
      providers: 'profile' as const,
      skills: 'profile' as const,
    },
  },
];

const llmProfile: LlmProfileConfig = {
  id: 'lp1',
  name: 'Anthropic',
  providerType: 'anthropic',
  models: [{ modelId: 'deepseek-v4-flash' }],
  isDefault: true,
  createdAt: 0,
  updatedAt: 0,
};

const saved: AgentProfileConfig = {
  id: 'p-new',
  name: 'Coding',
  llmProfileId: 'lp1',
  model: 'deepseek-v4-flash',
  systemPrompt: '',
  enabledTools: [],
  createdAt: 0,
  updatedAt: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  useRuntimeDescriptorStore.setState({ byBackend: { b1: RUNTIME_DESCRIPTORS } });
  vi.mocked(api.listLlmProfilesForBackend).mockResolvedValue([llmProfile]);
  vi.mocked(api.createAgentProfileForBackend).mockResolvedValue(saved);
});

function setup(overrides: Partial<Parameters<typeof NewAgentProfileModal>[0]> = {}) {
  const props = {
    open: true,
    backendId: 'b1',
    onClose: vi.fn(),
    onCreated: vi.fn(),
    ...overrides,
  };
  render(<NewAgentProfileModal {...props} />);
  return props;
}

describe('NewAgentProfileModal', () => {
  it('disables Create until a name is entered', async () => {
    setup();
    await waitFor(() => expect(api.listLlmProfilesForBackend).toHaveBeenCalled());
    const create = screen.getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Coding' } });
    expect(create).toBeEnabled();
  });

  it('creates immediately and fires onCreated with the saved profile', async () => {
    const props = setup();
    await waitFor(() => expect(api.listLlmProfilesForBackend).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Coding' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(api.createAgentProfileForBackend).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({
          name: 'Coding',
          runtimeType: 'zclaudia',
          llmProfileId: 'lp1',
          model: 'deepseek-v4-flash',
        })
      )
    );
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledWith(saved));
  });

  it('shows an inline error and keeps Create disabled when the default LLM profile has no models', async () => {
    vi.mocked(api.listLlmProfilesForBackend).mockResolvedValue([{ ...llmProfile, models: [] }]);
    setup();
    await waitFor(() => expect(api.listLlmProfilesForBackend).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Coding' } });
    expect(screen.getByText(/no available models/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(api.createAgentProfileForBackend).not.toHaveBeenCalled();
  });

  it('shows a loading hint and keeps Create disabled when no runtime descriptors are available yet', async () => {
    useRuntimeDescriptorStore.setState({ byBackend: {} });
    setup();
    await waitFor(() => expect(api.listLlmProfilesForBackend).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Coding' } });
    expect(screen.getByText(/agent runtimes are still loading/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(api.createAgentProfileForBackend).not.toHaveBeenCalled();
  });
});
