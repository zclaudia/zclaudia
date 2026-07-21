import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InstalledPlugin } from '../../stores/pluginStore';
import { PluginDetailModal } from './PluginDetailModal';

const managedPlugin: InstalledPlugin = {
  manifest: {
    id: 'com.test.agent',
    name: 'Test Agent',
    version: '2.0.0',
    description: 'A managed test agent',
    permissions: ['network.fetch'],
  },
  path: '/plugins/com.test.agent',
  status: 'idle',
  enabled: false,
  installedAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  source: 'managed',
  activeVersion: '2.0.0',
  availableVersions: ['2.0.0', '1.0.0'],
  canRollback: true,
  requirements: [{ name: 'test-agent', found: false, source: 'manifest' }],
};

describe('PluginDetailModal', () => {
  it('shows managed version, permissions, requirements, rollback, and uninstall controls', () => {
    render(
      <PluginDetailModal
        plugin={managedPlugin}
        open
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onInstallAnother={vi.fn()}
        onManageDirectories={vi.fn()}
      />
    );

    expect(screen.getByText('Managed package')).toBeInTheDocument();
    expect(screen.getByText('network.fetch')).toBeInTheDocument();
    expect(screen.getByText('test-agent')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Rollback version' })).toHaveValue('1.0.0');
    expect(screen.getByRole('button', { name: /roll back/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /uninstall/i })).toBeInTheDocument();
  });

  it('keeps development directory management separate from package uninstall', () => {
    render(
      <PluginDetailModal
        plugin={{
          ...managedPlugin,
          source: 'development',
          activeVersion: undefined,
          availableVersions: [],
          canRollback: false,
        }}
        open
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onInstallAnother={vi.fn()}
        onManageDirectories={vi.fn()}
      />
    );
    expect(screen.getByText('Development directory')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manage directories/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /uninstall/i })).toBeNull();
  });
});
