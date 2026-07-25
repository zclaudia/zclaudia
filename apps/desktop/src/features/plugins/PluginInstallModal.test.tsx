// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PluginInstallModal } from './PluginInstallModal';
import { ApiError } from '../../services/api/unwrap';
import type { PluginPackagePreview } from '../../services/api/plugin-packages';

vi.mock('../../services/api/plugin-packages', () => ({
  inspectPluginPackage: vi.fn(),
  installPluginPackage: vi.fn(),
}));

import { inspectPluginPackage, installPluginPackage } from '../../services/api/plugin-packages';

const inspectMock = vi.mocked(inspectPluginPackage);
const installMock = vi.mocked(installPluginPackage);

function makePreview(overrides: Partial<PluginPackagePreview> = {}): PluginPackagePreview {
  return {
    token: 'tok-1',
    fileName: 'plugin.zplugin',
    size: 128,
    sha256: 'deadbeef',
    fileCount: 2,
    unpackedSize: 256,
    manifest: {
      id: 'com.test.plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test plugin',
      permissions: [],
    },
    permissions: [],
    requirements: [],
    warnings: [],
    action: 'install',
    expiresAt: new Date('2026-07-25T01:00:00.000Z').toISOString(),
    ...overrides,
  };
}

function setup() {
  const onClose = vi.fn();
  const onInstalled = vi.fn().mockResolvedValue(undefined);
  const onViewPlugin = vi.fn();
  render(
    <PluginInstallModal
      open
      onClose={onClose}
      onInstalled={onInstalled}
      onViewPlugin={onViewPlugin}
    />
  );
  return { onClose, onInstalled, onViewPlugin };
}

function chooseFile(name = 'plugin.zplugin') {
  const input = screen.getByLabelText('Choose plugin package');
  const file = new File(['zip-bytes'], name, { type: 'application/zip' });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('PluginInstallModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('walks select → review → complete on a successful install', async () => {
    const { onInstalled } = setup();
    inspectMock.mockResolvedValue(makePreview());
    installMock.mockResolvedValue({ id: 'com.test.plugin', inactive: true });

    chooseFile();
    expect(await screen.findByText('Test Plugin')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(await screen.findByText('Test Plugin installed')).toBeInTheDocument();
    expect(installMock).toHaveBeenCalledWith('tok-1');
    expect(onInstalled).toHaveBeenCalled();
  });

  it('returns to file selection when the preview token has expired', async () => {
    setup();
    inspectMock.mockResolvedValue(makePreview());
    installMock.mockRejectedValue(
      new ApiError(
        'Plugin package preview expired; choose the file again',
        'PACKAGE_PREVIEW_EXPIRED'
      )
    );

    chooseFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));

    // The dead preview is dropped: the user is back at file selection with an
    // explanation, instead of stuck on a Review screen that always fails.
    expect(await screen.findByText('Choose a .zplugin package')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('preview expired');
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });

  it('stays on the review screen after a retryable install failure', async () => {
    setup();
    inspectMock.mockResolvedValue(makePreview());
    installMock.mockRejectedValue(new ApiError('disk full', 'INSTALLATION_FAILED'));

    chooseFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
  });

  it('shows the inspection error and returns to select on an invalid package', async () => {
    setup();
    inspectMock.mockRejectedValue(
      new ApiError('plugin.json failed validation', 'INVALID_MANIFEST')
    );

    chooseFile();
    expect(await screen.findByRole('alert')).toHaveTextContent('plugin.json failed validation');
    expect(screen.getByText('Choose a .zplugin package')).toBeInTheDocument();
    expect(installMock).not.toHaveBeenCalled();
  });
});
