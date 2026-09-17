import path from 'node:path';
import type {
  ManagedRuntimeArtifact,
  ManagedRuntimeAuthProbe,
  ManagedRuntimePlatformKey,
  ManagedRuntimePolicy,
  ManagedRuntimeAuthState,
  ManagedRuntimeVerification,
  RuntimeCompatibilityDescriptor,
} from '@zclaudia/shared/plugins/managed-runtimes';

export const SETTINGS_FILE = 'managed-runtime-settings.json';
export const INSTALLATION_FILE = 'installation.json';
export const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export interface RegisteredRuntime {
  pluginId: string;
  pluginVersion: string;
  pluginPath?: string;
  publisher?: string;
  publisherVerified: boolean;
  descriptor: RuntimeCompatibilityDescriptor;
  origin: 'plugin' | 'catalog';
}

export interface ManagedRuntimeSettings {
  schemaVersion: 1;
  policy: ManagedRuntimePolicy;
  trustedPublishers: string[];
  enterpriseMirrorOrigins: string[];
}

export interface InstallationRecord {
  schemaVersion: 1;
  runtime: string;
  version: string;
  platform: ManagedRuntimePlatformKey;
  executablePath: string;
  installedAt: string;
  verification: ManagedRuntimeVerification;
  authState: ManagedRuntimeAuthState;
}

export type StoredInstallation = InstallationRecord & { absoluteExecutablePath: string };

export interface RuntimeReference {
  schemaVersion: 1;
  pluginId: string;
  pluginVersion: string;
  runtime: string;
  platform: ManagedRuntimePlatformKey;
  versions: string[];
  selectedVersion?: string;
  selectionHistory: string[];
  updatedAt: string;
}

export interface ArtifactCandidate {
  version: string;
  artifact: ManagedRuntimeArtifact;
  authProbe?: ManagedRuntimeAuthProbe;
}

export function splitEnvList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

export function assertIdentity(value: string, label: string): void {
  if (!/^[a-zA-Z0-9_.-]+$/.test(value)) {
    throw new Error(`${label} contains unsafe path characters`);
  }
}

export function runtimeStoreDir(
  storeDir: string,
  runtime: string,
  version: string,
  platform: ManagedRuntimePlatformKey
): string {
  assertIdentity(runtime, 'runtime');
  if (!VERSION_PATTERN.test(version)) throw new Error('Runtime version is invalid');
  return path.join(storeDir, runtime, version, platform);
}

export function runtimeReferencePath(
  refsDir: string,
  pluginId: string,
  pluginVersion: string
): string {
  assertIdentity(pluginId, 'pluginId');
  if (!VERSION_PATTERN.test(pluginVersion)) throw new Error('Plugin version is invalid');
  return path.join(refsDir, pluginId, `${pluginVersion}.json`);
}
