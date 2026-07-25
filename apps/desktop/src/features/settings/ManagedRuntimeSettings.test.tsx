// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagedRuntimeSettings } from './ManagedRuntimeSettings';

vi.mock('../../hooks/useLocalBackendId', () => ({
  useLocalBackendId: () => 'local',
}));

vi.mock('../../services/api', () => ({
  listManagedRuntimes: vi.fn(),
  getManagedRuntimeSettings: vi.fn(),
  setManagedRuntimePolicy: vi.fn(),
  installManagedRuntime: vi.fn(),
  pinManagedRuntime: vi.fn(),
  rollbackManagedRuntime: vi.fn(),
  testManagedRuntime: vi.fn(),
  garbageCollectManagedRuntimes: vi.fn(),
}));

import {
  getManagedRuntimeSettings,
  installManagedRuntime,
  listManagedRuntimes,
} from '../../services/api';

const artifact = {
  pluginId: 'com.example.fixture',
  pluginVersion: '1.0.0',
  runtime: 'fixture',
  version: '1.2.3',
  platform: 'linux-x64' as const,
  url: 'https://downloads.example.invalid/fixture.tar.gz',
  sha256: 'a'.repeat(64),
  archiveFormat: 'tar.gz' as const,
  executablePath: 'bin/fixture',
  size: 4096,
  signatureDeclared: false,
  provenanceDeclared: false,
  trustedForAuto: false,
};

describe('ManagedRuntimeSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getManagedRuntimeSettings).mockResolvedValue({
      policy: 'managed-ask',
      trustedPublishers: [],
      enterpriseMirrorOrigins: [],
    });
    vi.mocked(listManagedRuntimes).mockResolvedValue([
      {
        pluginId: artifact.pluginId,
        pluginVersion: artifact.pluginVersion,
        runtime: artifact.runtime,
        policy: 'managed-ask',
        trustedForAuto: false,
        canRollback: false,
        installedVersions: [],
        resolution: {
          status: 'needs-approval',
          runtime: artifact.runtime,
          pluginId: artifact.pluginId,
          pluginVersion: artifact.pluginVersion,
          compatibilityState: 'missing',
          authState: 'unknown',
          verification: { checksumVerified: false },
          artifact,
          message: 'Managed runtime download needs user approval.',
        },
      },
    ]);
    vi.mocked(installManagedRuntime).mockResolvedValue({
      status: 'resolved',
      runtime: artifact.runtime,
      executablePath: '/runtime-store/fixture/1.2.3/linux-x64/bin/fixture',
      version: artifact.version,
      source: 'managed',
      compatibilityState: 'compatible',
      authState: 'authenticated',
      verification: { checksumVerified: true },
    });
  });

  it('shows artifact evidence before explicit download approval', async () => {
    render(<ManagedRuntimeSettings />);

    expect(await screen.findByTestId('managed-runtime-fixture')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review download' }));

    const approval = screen.getByTestId('managed-runtime-approval');
    expect(approval).toHaveTextContent(artifact.url);
    expect(approval).toHaveTextContent(artifact.sha256);
    expect(approval).toHaveTextContent('4.0 KB');
    expect(installManagedRuntime).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm download' }));
    await waitFor(() => expect(installManagedRuntime).toHaveBeenCalledWith('local', artifact));
  });
});
