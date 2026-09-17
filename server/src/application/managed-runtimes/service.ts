import { rm } from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import type {
  ManagedInstallDescriptor,
  ManagedRuntimeArtifact,
  ManagedRuntimeArtifactSummary,
  ManagedRuntimePlatformKey,
  ManagedRuntimePolicy,
  ManagedRuntimeResolution,
  RuntimeCompatibilityDescriptor,
} from '@zclaudia/shared/plugins/managed-runtimes';
import { MANAGED_RUNTIME_POLICIES } from '@zclaudia/shared/plugins/managed-runtimes';
import { resolveDataDir } from '../../utils/data-dir.js';
import {
  platformKey,
  readRuntimeCompatibilityDescriptor,
  validateRuntimeCompatibilityDescriptor,
} from './descriptor.js';
import { collectGarbage } from './gc.js';
import { validateDownloadUrl } from './downloader.js';
import { stageFreshInstall, withInstallLock } from './installer.js';
import {
  findExecutable,
  inspectExecutable,
  usableCompatibility,
  type ExecutableInspection,
} from './process-probe.js';
import {
  artifactCandidate,
  inheritPluginReference,
  installationMatchesRegistration,
  listInstalled,
  readInstallation,
  readRuntimeReference,
  resolvedFromInspection,
  resolvedManaged,
  updateRuntimeReference,
} from './resolver.js';
import { readJson, writeJsonAtomic } from './store.js';
import {
  dedupe,
  runtimeReferencePath,
  SETTINGS_FILE,
  splitEnvList,
  VERSION_PATTERN,
  type ArtifactCandidate,
  type InstallationRecord,
  type ManagedRuntimeSettings,
  type RegisteredRuntime,
  type RuntimeReference,
  type StoredInstallation,
} from './types.js';

const DEFAULT_GC_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

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

export interface ManagedRuntimeServiceOptions {
  dataDir?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  policy?: ManagedRuntimePolicy;
  trustedPublishers?: string[];
  enterpriseMirrorOrigins?: string[];
  gcGraceMs?: number;
}

function defaultSettings(options: ManagedRuntimeServiceOptions): ManagedRuntimeSettings {
  const env = options.env ?? process.env;
  return {
    schemaVersion: 1,
    policy: options.policy ?? 'managed-ask',
    trustedPublishers: dedupe([
      ...(options.trustedPublishers ?? []),
      ...splitEnvList(env.ZCLAUDIA_TRUSTED_RUNTIME_PUBLISHERS),
    ]),
    enterpriseMirrorOrigins: dedupe([
      ...(options.enterpriseMirrorOrigins ?? []),
      ...splitEnvList(env.ZCLAUDIA_RUNTIME_MIRROR_ORIGINS),
    ]),
  };
}

export class ManagedRuntimeResolutionError extends Error {
  constructor(readonly resolution: ManagedRuntimeResolution) {
    super(resolution.message ?? `Managed runtime resolution failed: ${resolution.status}`);
    this.name = 'ManagedRuntimeResolutionError';
  }
}

export class ManagedRuntimeService {
  readonly dataDir: string;
  readonly storeDir: string;
  readonly refsDir: string;
  readonly stagingDir: string;
  readonly locksDir: string;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => Date;
  private readonly gcGraceMs: number;
  private readonly initialSettings: ManagedRuntimeSettings;
  private readonly registrations = new Map<string, RegisteredRuntime>();
  private readonly storeMutationMutex = new Mutex();

  constructor(options: ManagedRuntimeServiceOptions = {}) {
    this.dataDir = path.resolve(options.dataDir ?? resolveDataDir());
    this.storeDir = path.join(this.dataDir, 'runtime-store');
    this.refsDir = path.join(this.dataDir, 'runtime-refs');
    this.stagingDir = path.join(this.dataDir, 'runtime-staging');
    this.locksDir = path.join(this.dataDir, 'runtime-locks');
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.env = { ...(options.env ?? process.env) };
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.gcGraceMs = options.gcGraceMs ?? DEFAULT_GC_GRACE_MS;
    this.initialSettings = defaultSettings(options);
  }

  private registrationKey(pluginId: string, runtime: string): string {
    return `${pluginId}\0${runtime}`;
  }

  async registerPlugin(options: {
    pluginId: string;
    pluginVersion: string;
    pluginPath: string;
    publisher?: string;
    publisherVerified?: boolean;
    runtimes: string[];
    /** Host-owned built-ins retain the user's CLI selection across app updates. */
    preservePreviousReference?: boolean;
  }): Promise<RuntimeCompatibilityDescriptor | undefined> {
    const descriptor = await readRuntimeCompatibilityDescriptor(
      options.pluginPath,
      options.runtimes
    );
    if (!descriptor) return undefined;
    if (options.preservePreviousReference) {
      await inheritPluginReference({
        refsDir: this.refsDir,
        platform: this.platformKey(),
        pluginId: options.pluginId,
        pluginVersion: options.pluginVersion,
        runtime: descriptor.runtime,
      });
    }
    this.registrations.set(this.registrationKey(options.pluginId, descriptor.runtime), {
      pluginId: options.pluginId,
      pluginVersion: options.pluginVersion,
      pluginPath: options.pluginPath,
      publisher: options.publisher,
      publisherVerified: options.publisherVerified === true,
      descriptor,
      origin: 'plugin',
    });
    return descriptor;
  }

  registerCatalogDescriptor(options: {
    pluginId: string;
    pluginVersion: string;
    publisher?: string;
    descriptor: RuntimeCompatibilityDescriptor;
  }): void {
    const descriptor = validateRuntimeCompatibilityDescriptor(options.descriptor);
    this.registrations.set(this.registrationKey(options.pluginId, descriptor.runtime), {
      pluginId: options.pluginId,
      pluginVersion: options.pluginVersion,
      publisher: options.publisher,
      publisherVerified: true,
      descriptor,
      origin: 'catalog',
    });
  }

  unregisterPlugin(pluginId: string): void {
    for (const [key, registration] of this.registrations) {
      if (registration.pluginId === pluginId) this.registrations.delete(key);
    }
  }

  private registrationForRuntime(runtime: string): RegisteredRuntime | undefined {
    return [...this.registrations.values()].find(entry => entry.descriptor.runtime === runtime);
  }

  private registrationForPlugin(pluginId: string, runtime: string): RegisteredRuntime | undefined {
    return this.registrations.get(this.registrationKey(pluginId, runtime));
  }

  private settingsPath(): string {
    return path.join(this.dataDir, SETTINGS_FILE);
  }

  async getSettings(): Promise<ManagedRuntimeSettings> {
    const stored = await readJson<ManagedRuntimeSettings>(this.settingsPath());
    if (
      !stored ||
      stored.schemaVersion !== 1 ||
      !MANAGED_RUNTIME_POLICIES.includes(stored.policy)
    ) {
      return { ...this.initialSettings };
    }
    return {
      schemaVersion: 1,
      policy: stored.policy,
      trustedPublishers: dedupe([
        ...this.initialSettings.trustedPublishers,
        ...(Array.isArray(stored.trustedPublishers) ? stored.trustedPublishers : []),
      ]),
      enterpriseMirrorOrigins: dedupe([
        ...this.initialSettings.enterpriseMirrorOrigins,
        ...(Array.isArray(stored.enterpriseMirrorOrigins) ? stored.enterpriseMirrorOrigins : []),
      ]),
    };
  }

  async setPolicy(policy: ManagedRuntimePolicy): Promise<ManagedRuntimeSettings> {
    if (!MANAGED_RUNTIME_POLICIES.includes(policy))
      throw new Error('Invalid managed runtime policy');
    const settings = { ...(await this.getSettings()), policy };
    await writeJsonAtomic(this.settingsPath(), settings);
    return settings;
  }

  private async trustedForAuto(registration: RegisteredRuntime): Promise<boolean> {
    if (registration.origin === 'catalog') return true;
    const settings = await this.getSettings();
    return (
      registration.publisherVerified &&
      !!registration.publisher &&
      settings.trustedPublishers.includes(registration.publisher)
    );
  }

  private platformKey(): ManagedRuntimePlatformKey | undefined {
    return platformKey(this.platform, this.arch);
  }

  private async readReference(
    registration: RegisteredRuntime
  ): Promise<RuntimeReference | undefined> {
    return await readRuntimeReference({ refsDir: this.refsDir, registration });
  }

  private async updateReference(
    registration: RegisteredRuntime,
    version: string,
    select: boolean
  ): Promise<RuntimeReference> {
    const platform = this.platformKey();
    if (!platform) throw new Error(`Unsupported platform ${this.platform}-${this.arch}`);
    return await updateRuntimeReference({
      refsDir: this.refsDir,
      platform,
      now: this.now,
      registration,
      version,
      select,
    });
  }

  async pinVersion(pluginId: string, pluginVersion: string, runtime: string, version?: string) {
    const registration = this.registrationForPlugin(pluginId, runtime);
    if (!registration || registration.pluginVersion !== pluginVersion) {
      throw new Error('Managed runtime metadata is not registered for this plugin version');
    }
    const ref = await this.readReference(registration);
    if (!version) {
      if (!ref) return undefined;
      const next = { ...ref, selectedVersion: undefined, updatedAt: this.now().toISOString() };
      await writeJsonAtomic(runtimeReferencePath(this.refsDir, pluginId, pluginVersion), next);
      return next;
    }
    if (!ref?.versions.includes(version))
      throw new Error('Managed runtime version is not installed');
    return await this.updateReference(registration, version, true);
  }

  async rollbackReference(pluginId: string, pluginVersion: string, runtime: string) {
    const registration = this.registrationForPlugin(pluginId, runtime);
    if (!registration || registration.pluginVersion !== pluginVersion) {
      throw new Error('Managed runtime metadata is not registered for this plugin version');
    }
    const ref = await this.readReference(registration);
    const previous = ref?.selectionHistory.at(-1);
    if (!ref || !previous)
      throw new Error('No managed runtime selection is available to roll back');
    const next: RuntimeReference = {
      ...ref,
      selectedVersion: previous,
      selectionHistory: ref.selectionHistory.slice(0, -1),
      updatedAt: this.now().toISOString(),
    };
    await writeJsonAtomic(runtimeReferencePath(this.refsDir, pluginId, pluginVersion), next);
    return next;
  }

  async releasePluginReference(pluginId: string, pluginVersion: string): Promise<void> {
    if (!/^[a-zA-Z0-9_.-]+$/.test(pluginId) || !VERSION_PATTERN.test(pluginVersion)) return;
    await rm(runtimeReferencePath(this.refsDir, pluginId, pluginVersion), { force: true });
  }

  private artifactCandidate(
    registration: RegisteredRuntime,
    requestedVersion?: string
  ): ArtifactCandidate | undefined {
    return artifactCandidate(registration, this.platformKey(), requestedVersion);
  }

  private async artifactSummary(
    registration: RegisteredRuntime,
    version: string,
    artifact: ManagedRuntimeArtifact
  ): Promise<ManagedRuntimeArtifactSummary> {
    const platform = this.platformKey();
    if (!platform) throw new Error('Unsupported managed runtime platform');
    return {
      pluginId: registration.pluginId,
      pluginVersion: registration.pluginVersion,
      runtime: registration.descriptor.runtime,
      version,
      platform,
      url: artifact.url,
      sha256: artifact.sha256.toLowerCase(),
      archiveFormat: artifact.archiveFormat,
      executablePath: artifact.executablePath,
      size: artifact.size,
      signatureDeclared: artifact.signature !== undefined,
      provenanceDeclared: artifact.provenance !== undefined,
      trustedForAuto: await this.trustedForAuto(registration),
    };
  }

  private async readInstallation(
    runtime: string,
    version: string,
    platform: ManagedRuntimePlatformKey
  ): Promise<StoredInstallation | undefined> {
    return await readInstallation({ storeDir: this.storeDir, runtime, version, platform });
  }

  private installationMatchesRegistration(
    registration: RegisteredRuntime,
    installation: InstallationRecord
  ): boolean {
    return installationMatchesRegistration(registration, installation);
  }

  private async listInstalled(registration: RegisteredRuntime): Promise<StoredInstallation[]> {
    return await listInstalled({
      storeDir: this.storeDir,
      platform: this.platformKey(),
      registration,
    });
  }

  private resolvedFromInspection(options: {
    registration: RegisteredRuntime;
    inspection: ExecutableInspection;
    source: 'explicit' | 'system';
  }): ManagedRuntimeResolution {
    return resolvedFromInspection(options);
  }

  private async resolvedManaged(
    registration: RegisteredRuntime,
    installation: StoredInstallation
  ): Promise<ManagedRuntimeResolution> {
    return await resolvedManaged(this.env, registration, installation);
  }

  async resolveForRuntime(
    runtime: string,
    options: {
      explicitPath?: string;
      headless?: boolean;
      allowAutoInstall?: boolean;
    } = {}
  ): Promise<ManagedRuntimeResolution | undefined> {
    const registration = this.registrationForRuntime(runtime);
    if (!registration) return undefined;
    return await this.resolveRegistration(registration, options);
  }

  async resolveForPlugin(
    pluginId: string,
    runtime: string,
    options: {
      explicitPath?: string;
      headless?: boolean;
      allowAutoInstall?: boolean;
    } = {}
  ): Promise<ManagedRuntimeResolution> {
    const registration = this.registrationForPlugin(pluginId, runtime);
    if (!registration) {
      return {
        status: 'managed-artifact-unavailable',
        runtime,
        pluginId,
        compatibilityState: 'not-declared',
        authState: 'unknown',
        verification: { checksumVerified: false },
        message: `Plugin ${pluginId} does not declare runtime compatibility metadata for ${runtime}.`,
      };
    }
    return await this.resolveRegistration(registration, options);
  }

  private async resolveRegistration(
    registration: RegisteredRuntime,
    options: {
      explicitPath?: string;
      headless?: boolean;
      allowAutoInstall?: boolean;
    }
  ): Promise<ManagedRuntimeResolution> {
    const descriptor = registration.descriptor;
    if (options.explicitPath?.trim()) {
      const inspection = await inspectExecutable(options.explicitPath.trim(), descriptor, this.env);
      return this.resolvedFromInspection({ registration, inspection, source: 'explicit' });
    }

    const platform = this.platformKey();
    const ref = await this.readReference(registration);
    if (platform && ref?.selectedVersion) {
      const selected = await this.readInstallation(
        descriptor.runtime,
        ref.selectedVersion,
        platform
      );
      if (selected && this.installationMatchesRegistration(registration, selected)) {
        return await this.resolvedManaged(registration, selected);
      }
    }

    const systemPath = findExecutable(descriptor.executable.command, this.env.PATH, this.platform);
    let rejectedSystem: ExecutableInspection | undefined;
    if (systemPath) {
      const inspection = await inspectExecutable(systemPath, descriptor, this.env);
      if (usableCompatibility(inspection.compatibilityState)) {
        return this.resolvedFromInspection({ registration, inspection, source: 'system' });
      }
      rejectedSystem = inspection;
    }

    const installedResolution = await this.storeMutationMutex.runExclusive(async () => {
      const installed = await this.listInstalled(registration);
      for (const installation of installed) {
        const resolved = await this.resolvedManaged(registration, installation);
        if (resolved.status === 'resolved' || resolved.status === 'auth-required') {
          // A shared-store hit becomes a reference for this plugin version too;
          // otherwise removing the original installer plugin could make GC
          // delete a CLI another plugin has already selected for use.
          await this.updateReference(registration, installation.version, false);
          return resolved;
        }
      }
      return undefined;
    });
    if (installedResolution) return installedResolution;

    const settings = await this.getSettings();
    const candidate = this.artifactCandidate(registration);
    if (settings.policy === 'system-only') {
      return {
        status: 'system-only',
        runtime: descriptor.runtime,
        pluginId: registration.pluginId,
        pluginVersion: registration.pluginVersion,
        compatibilityState: rejectedSystem?.compatibilityState ?? 'missing',
        authState: 'unknown',
        verification: { checksumVerified: false },
        message:
          rejectedSystem?.message ??
          'Managed runtime downloads are disabled by the system-only policy.',
      };
    }
    if (!candidate) {
      return {
        status: 'managed-artifact-unavailable',
        runtime: descriptor.runtime,
        pluginId: registration.pluginId,
        pluginVersion: registration.pluginVersion,
        compatibilityState: rejectedSystem?.compatibilityState ?? 'missing',
        authState: 'unknown',
        verification: { checksumVerified: false },
        message:
          rejectedSystem?.message ??
          `No verified managed artifact is declared for ${this.platform}-${this.arch}.`,
      };
    }
    try {
      validateDownloadUrl(candidate.artifact.url, settings);
      if (candidate.artifact.provenance) {
        validateDownloadUrl(candidate.artifact.provenance.url, settings);
      }
    } catch (error) {
      return {
        status: 'managed-artifact-unavailable',
        runtime: descriptor.runtime,
        pluginId: registration.pluginId,
        pluginVersion: registration.pluginVersion,
        compatibilityState: rejectedSystem?.compatibilityState ?? 'missing',
        authState: 'unknown',
        verification: { checksumVerified: false },
        message: error instanceof Error ? error.message : String(error),
      };
    }
    const artifact = await this.artifactSummary(
      registration,
      candidate.version,
      candidate.artifact
    );
    const canAutoInstall =
      settings.policy === 'managed-auto' &&
      artifact.trustedForAuto &&
      options.allowAutoInstall !== false;
    if (!canAutoInstall) {
      const untrustedAuto = settings.policy === 'managed-auto' && !artifact.trustedForAuto;
      return {
        status: 'needs-approval',
        runtime: descriptor.runtime,
        pluginId: registration.pluginId,
        pluginVersion: registration.pluginVersion,
        compatibilityState: rejectedSystem?.compatibilityState ?? 'missing',
        authState: 'unknown',
        verification: { checksumVerified: false },
        artifact,
        message: untrustedAuto
          ? 'Automatic download is blocked because the plugin publisher/catalog is not trusted. Explicit approval is required.'
          : options.headless
            ? 'Managed runtime download needs approval, but this caller is headless.'
            : 'Managed runtime download needs user approval.',
      };
    }
    return await this.install(registration, candidate.version, true, false);
  }

  async installForPlugin(options: {
    pluginId: string;
    pluginVersion: string;
    runtime: string;
    version?: string;
    approved: boolean;
    pin?: boolean;
  }): Promise<ManagedRuntimeResolution> {
    if (!options.approved) throw new Error('Explicit managed runtime approval is required');
    const registration = this.registrationForPlugin(options.pluginId, options.runtime);
    if (!registration || registration.pluginVersion !== options.pluginVersion) {
      throw new Error('Managed runtime metadata is not registered for this plugin version');
    }
    const candidate = this.artifactCandidate(registration, options.version);
    if (!candidate) {
      return {
        status: 'managed-artifact-unavailable',
        runtime: options.runtime,
        pluginId: options.pluginId,
        pluginVersion: options.pluginVersion,
        compatibilityState: 'missing',
        authState: 'unknown',
        verification: { checksumVerified: false },
        message: 'No verified managed artifact is available for the requested version/platform.',
      };
    }
    return await this.install(registration, candidate.version, true, options.pin !== false);
  }

  private async install(
    registration: RegisteredRuntime,
    version: string,
    approved: boolean,
    pin: boolean
  ): Promise<ManagedRuntimeResolution> {
    if (!approved) throw new Error('Managed runtime approval is required');
    const platform = this.platformKey();
    if (!platform) {
      return {
        status: 'managed-artifact-unavailable',
        runtime: registration.descriptor.runtime,
        pluginId: registration.pluginId,
        pluginVersion: registration.pluginVersion,
        compatibilityState: 'missing',
        authState: 'unknown',
        verification: { checksumVerified: false },
        message: `Unsupported managed runtime platform: ${this.platform}-${this.arch}.`,
      };
    }
    const candidate = this.artifactCandidate(registration, version);
    if (!candidate) {
      throw new Error(`Managed runtime artifact is unavailable: ${version}/${platform}`);
    }
    return await withInstallLock({
      locksDir: this.locksDir,
      runtime: registration.descriptor.runtime,
      version,
      platform,
      now: this.now,
      operation: async () => {
        const existingResolution = await this.storeMutationMutex.runExclusive(async () => {
          const existing = await this.readInstallation(
            registration.descriptor.runtime,
            version,
            platform
          );
          if (!existing) return undefined;
          if (!this.installationMatchesRegistration(registration, existing)) {
            throw new Error(
              `Managed runtime ${registration.descriptor.runtime}@${version} is already installed with a different trusted artifact digest`
            );
          }
          await this.updateReference(registration, version, pin);
          return await this.resolvedManaged(registration, existing);
        });
        if (existingResolution) return existingResolution;

        return await stageFreshInstall({
          registration,
          candidate,
          version,
          platform,
          pin,
          env: this.env,
          fetchImpl: this.fetchImpl,
          now: this.now,
          stagingDir: this.stagingDir,
          storeDir: this.storeDir,
          getSettings: () => this.getSettings(),
          readInstallation: (runtime, version, platform) =>
            this.readInstallation(runtime, version, platform),
          updateReference: (registration, version, select) =>
            this.updateReference(registration, version, select),
          runExclusive: <T>(operation: () => Promise<T>) =>
            this.storeMutationMutex.runExclusive(operation),
        });
      },
    });
  }

  async testRuntime(pluginId: string, runtime: string): Promise<ManagedRuntimeResolution> {
    return await this.resolveForPlugin(pluginId, runtime, {
      headless: true,
      allowAutoInstall: false,
    });
  }

  async listStatuses(): Promise<ManagedRuntimeStatus[]> {
    const policy = (await this.getSettings()).policy;
    const result: ManagedRuntimeStatus[] = [];
    for (const registration of this.registrations.values()) {
      const ref = await this.readReference(registration);
      const installed = await this.listInstalled(registration);
      result.push({
        pluginId: registration.pluginId,
        pluginVersion: registration.pluginVersion,
        runtime: registration.descriptor.runtime,
        policy,
        trustedForAuto: await this.trustedForAuto(registration),
        selectedVersion: ref?.selectedVersion,
        canRollback: (ref?.selectionHistory.length ?? 0) > 0,
        installedVersions: installed.map(entry => entry.version),
        resolution: await this.resolveRegistration(registration, {
          headless: true,
          allowAutoInstall: false,
        }),
      });
    }
    return result;
  }

  async garbageCollect(options: { graceMs?: number } = {}): Promise<{ removed: string[] }> {
    return await this.storeMutationMutex.runExclusive(
      async () =>
        await collectGarbage({
          refsDir: this.refsDir,
          storeDir: this.storeDir,
          now: this.now,
          graceMs: options.graceMs ?? this.gcGraceMs,
        })
    );
  }
}

export const managedRuntimeService = new ManagedRuntimeService();

export type { ManagedInstallDescriptor };
