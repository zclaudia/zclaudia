import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  ManagedRuntimePlatformKey,
  ManagedRuntimeResolution,
} from '@zclaudia/shared/plugins/managed-runtimes';
import {
  compareVersions,
  compatibilityForVersion,
  executableExists,
  inspectExecutable,
  runAuthProbe,
  usableCompatibility,
  type ExecutableInspection,
} from './process-probe.js';
import { readJson, writeJsonAtomic } from './store.js';
import {
  dedupe,
  INSTALLATION_FILE,
  runtimeReferencePath,
  runtimeStoreDir,
  VERSION_PATTERN,
  type ArtifactCandidate,
  type InstallationRecord,
  type RegisteredRuntime,
  type RuntimeReference,
  type StoredInstallation,
} from './types.js';

export async function readInstallation(options: {
  storeDir: string;
  runtime: string;
  version: string;
  platform: ManagedRuntimePlatformKey;
}): Promise<StoredInstallation | undefined> {
  const root = runtimeStoreDir(
    options.storeDir,
    options.runtime,
    options.version,
    options.platform
  );
  const record = await readJson<InstallationRecord>(path.join(root, INSTALLATION_FILE));
  if (
    !record ||
    record.schemaVersion !== 1 ||
    record.runtime !== options.runtime ||
    record.version !== options.version ||
    record.platform !== options.platform ||
    typeof record.executablePath !== 'string' ||
    !record.verification?.checksumVerified
  ) {
    return undefined;
  }
  const executablePath = path.resolve(root, ...record.executablePath.split('/'));
  if (executablePath !== root && !executablePath.startsWith(`${path.resolve(root)}${path.sep}`)) {
    return undefined;
  }
  if (!(await executableExists(executablePath))) return undefined;
  return { ...record, absoluteExecutablePath: executablePath };
}

export function installationMatchesRegistration(
  registration: RegisteredRuntime,
  installation: InstallationRecord
): boolean {
  const artifact = registration.descriptor.managedInstall?.versions.find(
    entry => entry.version === installation.version
  )?.artifacts[installation.platform];
  return (
    artifact !== undefined &&
    installation.verification.sha256?.toLowerCase() === artifact.sha256.toLowerCase()
  );
}

export async function listInstalled(options: {
  storeDir: string;
  platform: ManagedRuntimePlatformKey | undefined;
  registration: RegisteredRuntime;
}): Promise<StoredInstallation[]> {
  const { storeDir, platform, registration } = options;
  if (!platform) return [];
  const runtimeRoot = path.join(storeDir, registration.descriptor.runtime);
  const entries = await readdir(runtimeRoot, { withFileTypes: true }).catch(() => []);
  const installed = await Promise.all(
    entries
      .filter(entry => entry.isDirectory() && VERSION_PATTERN.test(entry.name))
      .map(entry =>
        readInstallation({
          storeDir,
          runtime: registration.descriptor.runtime,
          version: entry.name,
          platform,
        })
      )
  );
  return installed
    .filter(
      (entry): entry is StoredInstallation =>
        !!entry && installationMatchesRegistration(registration, entry)
    )
    .sort((a, b) => compareVersions(b.version, a.version));
}

export function artifactCandidate(
  registration: RegisteredRuntime,
  platform: ManagedRuntimePlatformKey | undefined,
  requestedVersion?: string
): ArtifactCandidate | undefined {
  const managed = registration.descriptor.managedInstall;
  if (!platform || !managed) return undefined;
  const versions = managed.versions.filter(entry => {
    if (!entry.artifacts[platform]) return false;
    if (requestedVersion && entry.version !== requestedVersion) return false;
    return compatibilityForVersion(entry.version, registration.descriptor).state === 'compatible';
  });
  const recommended =
    !requestedVersion && managed.recommendedVersion
      ? versions.find(entry => entry.version === managed.recommendedVersion)
      : undefined;
  const selected = recommended ?? versions.sort((a, b) => compareVersions(b.version, a.version))[0];
  const artifact = selected?.artifacts[platform];
  return selected && artifact
    ? {
        version: selected.version,
        artifact,
        authProbe: selected.authProbe ?? managed.authProbe,
      }
    : undefined;
}

export function resolvedFromInspection(options: {
  registration: RegisteredRuntime;
  inspection: ExecutableInspection;
  source: 'explicit' | 'system';
}): ManagedRuntimeResolution {
  const { registration, inspection, source } = options;
  const usable = usableCompatibility(inspection.compatibilityState);
  return {
    status: usable ? 'resolved' : 'blocked',
    runtime: registration.descriptor.runtime,
    pluginId: registration.pluginId,
    pluginVersion: registration.pluginVersion,
    executablePath: inspection.executablePath,
    version: inspection.version,
    source,
    compatibilityState: inspection.compatibilityState,
    authState: 'unknown',
    verification: { checksumVerified: false },
    warning: inspection.compatibilityState === 'untested-newer' ? inspection.message : undefined,
    message: usable ? undefined : inspection.message,
  };
}

export async function resolvedManaged(
  env: NodeJS.ProcessEnv,
  registration: RegisteredRuntime,
  installation: StoredInstallation
): Promise<ManagedRuntimeResolution> {
  const inspection = await inspectExecutable(
    installation.absoluteExecutablePath,
    registration.descriptor,
    env
  );
  if (!usableCompatibility(inspection.compatibilityState)) {
    return {
      status: 'blocked',
      runtime: registration.descriptor.runtime,
      pluginId: registration.pluginId,
      pluginVersion: registration.pluginVersion,
      executablePath: installation.absoluteExecutablePath,
      version: inspection.version ?? installation.version,
      source: 'managed',
      compatibilityState: inspection.compatibilityState,
      authState: installation.authState,
      verification: installation.verification,
      message: inspection.message,
    };
  }
  const managed = registration.descriptor.managedInstall;
  const versionEntry = managed?.versions.find(entry => entry.version === installation.version);
  const authState = await runAuthProbe(
    installation.absoluteExecutablePath,
    versionEntry?.authProbe ?? managed?.authProbe,
    env
  );
  return {
    status: authState === 'auth-required' ? 'auth-required' : 'resolved',
    runtime: registration.descriptor.runtime,
    pluginId: registration.pluginId,
    pluginVersion: registration.pluginVersion,
    executablePath: installation.absoluteExecutablePath,
    version: inspection.version ?? installation.version,
    source: 'managed',
    compatibilityState: inspection.compatibilityState,
    authState,
    verification: installation.verification,
    warning: inspection.compatibilityState === 'untested-newer' ? inspection.message : undefined,
    message:
      authState === 'auth-required'
        ? `Managed ${registration.descriptor.runtime} CLI requires authentication. Use this CLI's official login flow; ZClaudia does not copy or convert tokens.`
        : authState === 'probe-failed'
          ? 'The managed CLI auth probe could not be completed.'
          : undefined,
  };
}

export async function inheritPluginReference(options: {
  refsDir: string;
  platform: ManagedRuntimePlatformKey | undefined;
  pluginId: string;
  pluginVersion: string;
  runtime: string;
}): Promise<void> {
  const { refsDir, platform, pluginId, pluginVersion, runtime } = options;
  const destination = runtimeReferencePath(refsDir, pluginId, pluginVersion);
  if (existsSync(destination)) return;
  const directory = path.dirname(destination);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const candidates: RuntimeReference[] = [];
  for (const name of names) {
    if (!name.endsWith('.json') || !VERSION_PATTERN.test(name.slice(0, -5))) continue;
    const ref = await readJson<RuntimeReference>(path.join(directory, name));
    if (
      !ref ||
      ref.schemaVersion !== 1 ||
      ref.pluginId !== pluginId ||
      ref.pluginVersion !== name.slice(0, -5) ||
      ref.runtime !== runtime ||
      ref.platform !== platform ||
      !Array.isArray(ref.versions) ||
      !Array.isArray(ref.selectionHistory) ||
      !Number.isFinite(Date.parse(ref.updatedAt)) ||
      ![
        ...ref.versions,
        ...ref.selectionHistory,
        ...(ref.selectedVersion ? [ref.selectedVersion] : []),
      ].every(version => typeof version === 'string' && VERSION_PATTERN.test(version))
    )
      continue;
    candidates.push(ref);
  }
  candidates.sort(
    (a, b) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      b.pluginVersion.localeCompare(a.pluginVersion)
  );
  const previous = candidates[0];
  if (!previous) return;
  // Atomic additive copy; leave historical references for application rollback.
  // Resolution still validates the selected CLI against the new descriptor.
  await writeJsonAtomic(destination, { ...previous, pluginVersion });
}

export async function readRuntimeReference(options: {
  refsDir: string;
  registration: RegisteredRuntime;
}): Promise<RuntimeReference | undefined> {
  const ref = await readJson<RuntimeReference>(
    runtimeReferencePath(
      options.refsDir,
      options.registration.pluginId,
      options.registration.pluginVersion
    )
  );
  if (
    !ref ||
    ref.schemaVersion !== 1 ||
    ref.pluginId !== options.registration.pluginId ||
    ref.pluginVersion !== options.registration.pluginVersion ||
    ref.runtime !== options.registration.descriptor.runtime ||
    !Array.isArray(ref.versions) ||
    !Array.isArray(ref.selectionHistory)
  ) {
    return undefined;
  }
  return ref;
}

export async function updateRuntimeReference(options: {
  refsDir: string;
  platform: ManagedRuntimePlatformKey;
  now: () => Date;
  registration: RegisteredRuntime;
  version: string;
  select: boolean;
}): Promise<RuntimeReference> {
  const { refsDir, platform, now, registration, version, select } = options;
  const current = await readRuntimeReference({ refsDir, registration });
  const previousSelected = current?.selectedVersion;
  const next: RuntimeReference = {
    schemaVersion: 1,
    pluginId: registration.pluginId,
    pluginVersion: registration.pluginVersion,
    runtime: registration.descriptor.runtime,
    platform,
    versions: dedupe([...(current?.versions ?? []), version]),
    selectedVersion: select ? version : current?.selectedVersion,
    selectionHistory:
      select && previousSelected && previousSelected !== version
        ? [...(current?.selectionHistory ?? []), previousSelected].slice(-20)
        : (current?.selectionHistory ?? []),
    updatedAt: now().toISOString(),
  };
  await writeJsonAtomic(
    runtimeReferencePath(refsDir, registration.pluginId, registration.pluginVersion),
    next
  );
  return next;
}
