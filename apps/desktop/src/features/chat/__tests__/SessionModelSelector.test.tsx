import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionModelSettings } from '@zclaudia/shared/core/runtime-capabilities';
import { SessionModelSelector } from '../SessionModelSelector';
import { getSessionModelSettings, saveSessionModelSettings } from '../../../services/api/sessions';

vi.mock('../../../services/api/sessions', () => ({
  getSessionModelSettings: vi.fn(),
  saveSessionModelSettings: vi.fn(),
}));
let settings: SessionModelSettings;
beforeEach(() => {
  vi.clearAllMocks();
  settings = {
    selection: { model: null, thinkingLevel: null, revision: 0 },
    runtimeType: 'codex',
    engineMode: 'cli',
    inheritedModel: 'm1',
    models: [
      { id: 'm1', label: 'One', thinkingLevels: ['low'] },
      { id: 'm2', label: 'Two', thinkingLevels: ['low', 'high'] },
    ],
    allowManualModel: true,
    supportsPermissionOverrides: true,
    permissionNote: '',
  };
  vi.mocked(getSessionModelSettings).mockImplementation(async () => settings);
  vi.mocked(saveSessionModelSettings).mockImplementation(async (_, selection) => {
    settings = { ...settings, selection: { ...selection, revision: selection.revision + 1 } };
    return settings;
  });
});
async function open() {
  render(<SessionModelSelector sessionId="s" />);
  await screen.findByText('One');
  fireEvent.click(screen.getByRole('button', { name: 'Session model and thinking' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled());
}

describe('session model selector', () => {
  it('distinguishes inheritance from the Claude recommended model', async () => {
    settings.runtimeType = 'claude';
    settings.inheritedModel = '';
    settings.models = [
      { id: 'default', label: 'Default (recommended)' },
      { id: 'opus', label: 'Opus' },
    ];
    render(<SessionModelSelector sessionId="s" />);
    fireEvent.click(screen.getByRole('button', { name: 'Session model and thinking' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Session model' }));
    expect(await screen.findByRole('option', { name: 'Follow runtime' })).toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: /^Default/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('option', { name: 'Default (recommended)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(saveSessionModelSettings).toHaveBeenCalledWith('s', {
        model: 'default',
        thinkingLevel: null,
        revision: 0,
      })
    );
  });
  it('saves model and supported effort together for this session', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Session model' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Two' }));
    fireEvent.click(screen.getByRole('button', { name: 'Session thinking level' }));
    fireEvent.click(await screen.findByRole('option', { name: 'high' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(saveSessionModelSettings).toHaveBeenCalledWith('s', {
        model: 'm2',
        thinkingLevel: 'high',
        revision: 0,
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Two')).toBeInTheDocument();
  });
  it('clears effort when switching models and supports resetting both overrides', async () => {
    settings.selection = { model: 'm2', thinkingLevel: 'high', revision: 2 };
    render(<SessionModelSelector sessionId="s" />);
    await screen.findByText('Two');
    fireEvent.click(screen.getByRole('button', { name: 'Session model and thinking' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Session model' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Follow session default (m1)' }));
    expect(screen.getByRole('button', { name: 'Session thinking level' })).toHaveTextContent(
      'Default'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(saveSessionModelSettings).toHaveBeenCalledWith('s', {
        model: null,
        thinkingLevel: null,
        revision: 2,
      })
    );
  });
  it('uses Cursor variant IDs without inventing thinking choices', async () => {
    settings = {
      ...settings,
      runtimeType: 'cursor',
      inheritedModel: 'm1',
      allowManualModel: false,
      models: [
        { id: 'm1', label: 'One', thinkingLevels: [] },
        { id: 'm2[thinking=true]', label: 'Two (Thinking)', thinkingLevels: [] },
      ],
    };
    await open();
    expect(screen.getByRole('button', { name: 'Session thinking level' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Session model' }));
    expect(screen.queryByRole('option', { name: 'Custom model ID' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Two (Thinking)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(saveSessionModelSettings).toHaveBeenCalledWith('s', {
        model: 'm2[thinking=true]',
        thinkingLevel: null,
        revision: 0,
      })
    );
  });
  it('can reset a saved effort even when model discovery is unavailable', async () => {
    settings.selection = { model: null, thinkingLevel: 'high', revision: 1 };
    settings.models = [{ id: 'm1', label: 'One' }];
    await open();
    expect(screen.getByRole('button', { name: 'Session thinking level' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Use defaults' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(saveSessionModelSettings).toHaveBeenCalledWith('s', {
        model: null,
        thinkingLevel: null,
        revision: 1,
      })
    );
  });
  it('explicitly bypasses discovery cache on refresh', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(getSessionModelSettings).toHaveBeenCalledWith('s', 'refresh', expect.any(AbortSignal))
    );
  });
  it('keeps the editor open and shows conflicts instead of pretending to save', async () => {
    vi.mocked(saveSessionModelSettings).mockRejectedValue(
      new Error('Settings changed in another window')
    );
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings changed');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('does not discover or allow editing during a run', async () => {
    render(<SessionModelSelector sessionId="s" disabled />);
    await screen.findByText('One');
    expect(screen.getByRole('button', { name: 'Session model and thinking' })).toBeDisabled();
    expect(getSessionModelSettings).toHaveBeenCalledWith('s', false, expect.any(AbortSignal));
  });
});

describe('session model selector chip (mobile menu)', () => {
  async function openMenu(chipLabel = 'One') {
    render(<SessionModelSelector sessionId="s" variant="chip" />);
    await screen.findByText(chipLabel);
    fireEvent.click(screen.getByRole('button', { name: 'Session model and thinking' }));
    return screen.findByRole('menu', { name: 'Model' });
  }

  it('opens a compact menu grouped under the profile, with the active model checked', async () => {
    settings.profileName = 'Codex profile';
    settings.inheritedThinkingLevel = 'low';
    const menu = await openMenu();
    expect(menu).toHaveTextContent('Codex profile');
    expect(screen.getByRole('menuitemradio', { name: 'One' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('menuitemradio', { name: 'Two' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    expect(screen.getByRole('menuitem', { name: /Thinking/ })).toHaveTextContent('low');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('saves a picked model in one tap, keeping a thinking level the new model offers', async () => {
    settings.selection = { model: 'm1', thinkingLevel: 'low', revision: 3 };
    await openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Two' }));
    await waitFor(() =>
      expect(saveSessionModelSettings).toHaveBeenCalledWith('s', {
        model: 'm2',
        thinkingLevel: 'low',
        revision: 3,
      })
    );
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(await screen.findByText('Two')).toBeInTheDocument();
  });

  it('drops a thinking level the new model does not offer', async () => {
    settings.selection = { model: 'm2', thinkingLevel: 'high', revision: 0 };
    await openMenu('Two');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'One' }));
    await waitFor(() =>
      expect(saveSessionModelSettings).toHaveBeenCalledWith('s', {
        model: 'm1',
        thinkingLevel: null,
        revision: 0,
      })
    );
  });

  it('lists a saved custom model that discovery does not know', async () => {
    settings.selection = { model: 'custom-x', thinkingLevel: null, revision: 0 };
    await openMenu('custom-x');
    expect(screen.getByRole('menuitemradio', { name: 'custom-x' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('opens the detailed dialog from the Thinking row', async () => {
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Thinking/ }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Session model settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Session thinking level' })).toBeInTheDocument();
  });

  it('shows a failed save inside the menu', async () => {
    vi.mocked(saveSessionModelSettings).mockRejectedValue(new Error('Session is busy'));
    await openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Two' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Session is busy');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('keeps the dialog for the desktop trigger', async () => {
    await open();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Session model settings' })).toBeInTheDocument();
  });
});
