import type { Permission, PluginManifest } from '@zclaudia/shared';
import { fetchLocalApi } from './base';
import { ApiError } from './unwrap';

export interface PluginRequirementStatus {
  name: string;
  found: boolean;
  path?: string;
  source: 'manifest' | 'official';
}

export interface PluginPackagePreview {
  token: string;
  fileName: string;
  size: number;
  sha256: string;
  fileCount: number;
  unpackedSize: number;
  manifest: PluginManifest;
  permissions: Permission[];
  requirements: PluginRequirementStatus[];
  warnings: string[];
  action: 'install' | 'update' | 'reinstall';
  currentVersion?: string;
  expiresAt: string;
}

export interface PluginPackageMutationResult {
  id: string;
  version?: string;
  activeVersion?: string;
  inactive: true;
}

function unwrap<T>(
  result: {
    success: boolean;
    data?: T;
    error?: { code?: string; message?: string; details?: unknown };
  },
  fallback: string
): T {
  if (!result.success || result.data === undefined) {
    throw new ApiError(
      result.error?.message || fallback,
      result.error?.code,
      result.error?.details
    );
  }
  return result.data;
}

export async function inspectPluginPackage(file: File): Promise<PluginPackagePreview> {
  const body = new FormData();
  body.append('package', file, file.name);
  const result = await fetchLocalApi<PluginPackagePreview>('/api/plugins/packages/inspect', {
    method: 'POST',
    body,
  });
  return unwrap(result, 'Could not inspect plugin package');
}

export async function installPluginPackage(token: string): Promise<PluginPackageMutationResult> {
  const result = await fetchLocalApi<PluginPackageMutationResult>('/api/plugins/packages/install', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
  return unwrap(result, 'Could not install plugin package');
}

export async function rollbackPluginPackage(
  pluginId: string,
  version?: string
): Promise<PluginPackageMutationResult> {
  const result = await fetchLocalApi<PluginPackageMutationResult>(
    `/api/plugins/${encodeURIComponent(pluginId)}/rollback`,
    {
      method: 'POST',
      body: JSON.stringify({ version }),
    }
  );
  return unwrap(result, 'Could not roll back plugin');
}

export async function uninstallPluginPackage(pluginId: string): Promise<void> {
  const result = await fetchLocalApi<{ removed: true }>(
    `/api/plugins/${encodeURIComponent(pluginId)}`,
    { method: 'DELETE' }
  );
  unwrap(result, 'Could not uninstall plugin');
}
