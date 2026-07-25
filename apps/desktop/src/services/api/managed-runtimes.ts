import type {
  ManagedRuntimeArtifactSummary,
  ManagedRuntimePolicy,
  ManagedRuntimeResolution,
} from '@zclaudia/shared/plugins/managed-runtimes';
import { apiCallForBackend } from './unwrap';

export interface ManagedRuntimeStatus {
  pluginId: string;
  pluginVersion: string;
  runtime: string;
  policy: ManagedRuntimePolicy;
  trustedForAuto: boolean;
  selectedVersion?: string;
  canRollback: boolean;
  installedVersions: string[];
  resolution: ManagedRuntimeResolution;
}

export interface ManagedRuntimeSettings {
  policy: ManagedRuntimePolicy;
  trustedPublishers: string[];
  enterpriseMirrorOrigins: string[];
}

export async function listManagedRuntimes(
  backendId?: string | null
): Promise<ManagedRuntimeStatus[]> {
  return await apiCallForBackend<ManagedRuntimeStatus[]>(backendId, '/api/managed-runtimes');
}

export async function getManagedRuntimeSettings(
  backendId?: string | null
): Promise<ManagedRuntimeSettings> {
  return await apiCallForBackend<ManagedRuntimeSettings>(
    backendId,
    '/api/managed-runtimes/settings'
  );
}

export async function setManagedRuntimePolicy(
  backendId: string | null | undefined,
  policy: ManagedRuntimePolicy
): Promise<ManagedRuntimeSettings> {
  return await apiCallForBackend<ManagedRuntimeSettings>(
    backendId,
    '/api/managed-runtimes/settings/policy',
    { method: 'PUT', body: JSON.stringify({ policy }) }
  );
}

export async function installManagedRuntime(
  backendId: string | null | undefined,
  artifact: ManagedRuntimeArtifactSummary
): Promise<ManagedRuntimeResolution> {
  return await apiCallForBackend<ManagedRuntimeResolution>(
    backendId,
    '/api/managed-runtimes/install',
    {
      method: 'POST',
      body: JSON.stringify({
        pluginId: artifact.pluginId,
        pluginVersion: artifact.pluginVersion,
        runtime: artifact.runtime,
        version: artifact.version,
        approved: true,
        pin: true,
      }),
    }
  );
}

export async function pinManagedRuntime(
  backendId: string | null | undefined,
  status: ManagedRuntimeStatus,
  version?: string
): Promise<void> {
  await apiCallForBackend(backendId, '/api/managed-runtimes/pin', {
    method: 'POST',
    body: JSON.stringify({
      pluginId: status.pluginId,
      pluginVersion: status.pluginVersion,
      runtime: status.runtime,
      version,
    }),
  });
}

export async function rollbackManagedRuntime(
  backendId: string | null | undefined,
  status: ManagedRuntimeStatus
): Promise<void> {
  await apiCallForBackend(backendId, '/api/managed-runtimes/rollback', {
    method: 'POST',
    body: JSON.stringify({
      pluginId: status.pluginId,
      pluginVersion: status.pluginVersion,
      runtime: status.runtime,
    }),
  });
}

export async function testManagedRuntime(
  backendId: string | null | undefined,
  status: ManagedRuntimeStatus
): Promise<ManagedRuntimeResolution> {
  return await apiCallForBackend<ManagedRuntimeResolution>(
    backendId,
    '/api/managed-runtimes/test',
    {
      method: 'POST',
      body: JSON.stringify({ pluginId: status.pluginId, runtime: status.runtime }),
    }
  );
}

export async function garbageCollectManagedRuntimes(
  backendId?: string | null
): Promise<{ removed: string[] }> {
  return await apiCallForBackend<{ removed: string[] }>(backendId, '/api/managed-runtimes/gc', {
    method: 'POST',
  });
}
