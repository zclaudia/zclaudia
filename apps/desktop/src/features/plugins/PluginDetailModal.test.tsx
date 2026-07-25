// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PluginDetailModal } from './PluginDetailModal';
import type { InstalledPlugin } from '../../stores/pluginStore';

vi.mock('../../services/api/plugin-packages', () => ({
  rollbackPluginPackage: vi.fn(),
  uninstallPluginPackage: vi.fn(),
}));

vi.mock('../../stores/confirmDialogStore', () => ({
  confirm: vi.fn(),
}));

import { rollbackPluginPackage, uninstallPluginPackage } from '../../services/api/plugin-packages';
import { confirm } from '../../stores/confirmDialogStore';

const rollbackMock = vi.mocked(rollbackPluginPackage);
const uninstallMock = vi.mocked(uninstallPluginPackage);
const confirmMock = vi.mocked(confirm);

function makePlugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    manifest: {
      id: 'com.test.plugin',
      name: 'Test Plugin',
      version: '2.0.0',
      description: 'A test plugin',
      permissions: [],
    },
    path: '/data/plugins/com.test.plugin',
    status: 'inactive',
    enabled: false,
    installedAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    source: 'managed',
    activeVersion: '2.0.0',
    availableVersions: ['2.0.0', '1.0.0'],
    canRollback: true,
    requirements: [],
    ...overrides,
  };
}

function setup(plugin: InstalledPlugin | null = makePlugin()) {
  const props = {
    onClose: vi.fn(),
    onChanged: vi.fn().mockResolvedValue(undefined),
    onInstallAnother: vi.fn(),
    onManageDirectories: vi.fn(),
  };
  render(<PluginDetailModal plugin={plugin} open {...props} />);
  return props;
}

describe('PluginDetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing without a plugin', () => {
    const { container } = render(
      <PluginDetailModal
        plugin={null}
        open
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onInstallAnother={vi.fn()}
        onManageDirectories={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('rolls back to the selected version after confirmation', async () => {
    const { onChanged } = setup();
    confirmMock.mockResolvedValue(true);
    rollbackMock.mockResolvedValue({ id: 'com.test.plugin', inactive: true });

    fireEvent.change(screen.getByLabelText('Rollback version'), { target: { value: '1.0.0' } });
    fireEvent.click(screen.getByRole('button', { name: /Roll back/ }));

    await waitFor(() => expect(rollbackMock).toHaveBeenCalledWith('com.test.plugin', '1.0.0'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('does not roll back when the confirmation is declined', async () => {
    setup();
    confirmMock.mockResolvedValue(false);

    fireEvent.click(screen.getByRole('button', { name: /Roll back/ }));

    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(rollbackMock).not.toHaveBeenCalled();
  });

  it('shows an inline error when rollback fails', async () => {
    setup();
    confirmMock.mockResolvedValue(true);
    rollbackMock.mockRejectedValue(new Error('version directory missing'));

    fireEvent.click(screen.getByRole('button', { name: /Roll back/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('version directory missing');
  });

  it('uninstalls after confirmation and closes the modal', async () => {
    const { onChanged, onClose } = setup();
    confirmMock.mockResolvedValue(true);
    uninstallMock.mockResolvedValue(undefined);

    fireEvent.click(screen.getByRole('button', { name: /Uninstall/ }));

    await waitFor(() => expect(uninstallMock).toHaveBeenCalledWith('com.test.plugin'));
    expect(onChanged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows directory management instead of package versions for development plugins', () => {
    const { onManageDirectories } = setup(
      makePlugin({ source: 'development', availableVersions: [], canRollback: false })
    );

    expect(screen.getByText('Development plugin')).toBeInTheDocument();
    expect(screen.queryByText('Package versions')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Manage directories/ }));
    expect(onManageDirectories).toHaveBeenCalled();
  });
});
