import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginInstallModal } from './PluginInstallModal';
import { inspectPluginPackage, installPluginPackage } from '../../services/api/plugin-packages';

vi.mock('../../services/api/plugin-packages', () => ({
  inspectPluginPackage: vi.fn(),
  installPluginPackage: vi.fn(),
}));

const preview = {
  token: 'preview-token',
  fileName: 'agent.zplugin',
  size: 1024,
  sha256: 'a'.repeat(64),
  fileCount: 3,
  unpackedSize: 2048,
  manifest: {
    id: 'com.test.agent',
    name: 'Test Agent',
    version: '1.0.0',
    description: 'Test package',
  },
  permissions: ['network.fetch'],
  requirements: [{ name: 'test-agent', found: false, source: 'manifest' as const }],
  warnings: ['test-agent was not found on PATH.'],
  action: 'install' as const,
  expiresAt: '2026-07-21T00:15:00.000Z',
};

describe('PluginInstallModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(inspectPluginPackage).mockResolvedValue(preview);
    vi.mocked(installPluginPackage).mockResolvedValue({
      id: 'com.test.agent',
      version: '1.0.0',
      activeVersion: '1.0.0',
      inactive: true,
    });
  });

  it('validates, previews, and installs a package without activating it', async () => {
    const onInstalled = vi.fn();
    render(
      <PluginInstallModal open onClose={vi.fn()} onInstalled={onInstalled} onViewPlugin={vi.fn()} />
    );

    const file = new File(['package'], 'agent.zplugin', { type: 'application/zip' });
    fireEvent.change(screen.getByLabelText('Choose plugin package'), {
      target: { files: [file] },
    });

    await screen.findByText('Test Agent');
    expect(screen.getByText('network.fetch')).toBeInTheDocument();
    expect(
      screen.getByText('Not found on PATH. Install it before activating this plugin.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    await screen.findByText('Test Agent installed');
    expect(installPluginPackage).toHaveBeenCalledWith('preview-token');
    expect(onInstalled).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/currently inactive/i)).toBeInTheDocument();
  });

  it('returns to file selection with an actionable validation error', async () => {
    vi.mocked(inspectPluginPackage).mockRejectedValue(new Error('Unsafe archive path'));
    render(
      <PluginInstallModal open onClose={vi.fn()} onInstalled={vi.fn()} onViewPlugin={vi.fn()} />
    );
    fireEvent.change(screen.getByLabelText('Choose plugin package'), {
      target: { files: [new File(['bad'], 'bad.zplugin')] },
    });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unsafe archive path'));
    expect(screen.getByText('Choose a .zplugin package')).toBeInTheDocument();
  });
});
