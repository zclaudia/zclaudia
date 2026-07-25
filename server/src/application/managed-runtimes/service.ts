import { createHash, randomUUID, verify as verifySignature } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import type {
  ManagedInstallDescriptor,
  ManagedRuntimeArtifact,
  ManagedRuntimeArtifactSummary,
  ManagedRuntimeAuthProbe,
  ManagedRuntimeAuthState,
  ManagedRuntimeCompatibilityState,
  ManagedRuntimePlatformKey,
  ManagedRuntimePolicy,
  ManagedRuntimeResolution,
  ManagedRuntimeVerification,
  RuntimeCompatibilityDescriptor,
  RuntimeProbeDescriptor,
} from '@zclaudia/shared/plugins/managed-runtimes';
import {
  MANAGED_RUNTIME_PLATFORM_KEYS,
  MANAGED_RUNTIME_POLICIES,
} from '@zclaudia/shared/plugins/managed-runtimes';
import { resolveDataDir } from '../../utils/data-dir.js';
import { extractManagedRuntimeArtifact, MANAGED_RUNTIME_LIMITS } from './archive.js';
import {
  platformKey,
  readRuntimeCompatibilityDescriptor,
  validateRuntimeCompatibilityDescriptor,
} from './descriptor.js';

const SETTINGS_FILE = 'managed-runtime-settings.json';
const INSTALLATION_FILE = 'installation.json';
const LOCK_STALE_MS = 15 * 60 * 1000;
const LOCK_WAIT_MS = 60 * 1000;
const DEFAULT_GC_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const PROCESS_OUTPUT_LIMIT = 1024 * 1024;
const PROVENANCE_SIZE_LIMIT = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

interface RegisteredRuntime {
  pluginId: string;
  pluginVersion: string;
  pluginPath?: string;
  publisher?: string;
  publisherVerified: boolean;
  descriptor: RuntimeCompatibilityDescriptor;
  origin: 'plugin' | 'catalog';
}

interface ManagedRuntimeSettings {
  schemaVersion: 1;
  policy: ManagedRuntimePolicy;
  trustedPublishers: string[];
  enterpriseMirrorOrigins: string[];
}

interface InstallationRecord {
  schemaVersion: 1;
  runtime: string;
  version: string;
  platform: ManagedRuntimePlatformKey;
  executablePath: string;
  installedAt: string;
  verification: ManagedRuntimeVerification;
  authState: ManagedRuntimeAuthState;
}

interface RuntimeReference {
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

interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut: boolean;
}

interface ExecutableInspection {
  executablePath: string;
  version?: string;
  compatibilityState: ManagedRuntimeCompatibilityState;
  message?: string;
  probe?: ProcessResult;
}

interface DownloadResult {
  sha256: string;
  size: number;
  finalUrl: string;
}

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

function splitEnvList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
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

function assertIdentity(value: string, label: string): void {
  if (!/^[a-zA-Z0-9_.-]+$/.test(value)) {
    throw new Error(`${label} contains unsafe path characters`);
  }
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
    if (!match) throw new Error(`Invalid runtime version: ${value}`);
    return match.slice(1).map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function compatibilityForVersion(
  version: string | undefined,
  descriptor: RuntimeCompatibilityDescriptor
): { state: ManagedRuntimeCompatibilityState; message?: string } {
  if (!version) return { state: 'unparseable', message: 'CLI version could not be parsed.' };
  const policy = descriptor.versionPolicy;
  if (policy?.knownIncompatible?.includes(version)) {
    return {
      state: 'known-incompatible',
      message: `${version} is marked as known incompatible.`,
    };
  }
  if (policy?.minimum && compareVersions(version, policy.minimum) < 0) {
    return {
      state: 'too-old',
      message: `${version} is older than required minimum ${policy.minimum}.`,
    };
  }
  if (policy?.testedMaximum && compareVersions(version, policy.testedMaximum) > 0) {
    return {
      state: 'untested-newer',
      message: `${version} is newer than tested maximum ${policy.testedMaximum}.`,
    };
  }
  return { state: 'compatible' };
}

function usableCompatibility(state: ManagedRuntimeCompatibilityState): boolean {
  return state === 'compatible' || state === 'untested-newer';
}

function boundedAppend(current: string, chunk: Buffer | string): string {
  if (current.length >= PROCESS_OUTPUT_LIMIT) return current;
  return `${current}${chunk.toString()}`.slice(0, PROCESS_OUTPUT_LIMIT);
}

async function runProcess(
  executable: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    cwd?: string;
    timeoutMs?: number;
    stdin?: string;
  }
): Promise<ProcessResult> {
  return await new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    // Assigned after spawn so synchronous spawn failures can return without
    // creating a timer; finish() may run from child events immediately after.
    // eslint-disable-next-line prefer-const
    let timer: NodeJS.Timeout | undefined;
    let child: ReturnType<typeof spawn>;
    const finish = (result: Omit<ProcessResult, 'stdout' | 'stderr'>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ...result, stdout, stderr });
    };
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        env: { ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        code: null,
        signal: null,
        stdout,
        stderr,
        error: error instanceof Error ? error.message : String(error),
        timedOut: false,
      });
      return;
    }
    child.stdout?.on('data', chunk => {
      stdout = boundedAppend(stdout, chunk);
    });
    child.stderr?.on('data', chunk => {
      stderr = boundedAppend(stderr, chunk);
    });
    child.once('error', error => {
      finish({
        code: null,
        signal: null,
        error: error.message,
        timedOut: false,
      });
    });
    child.once('close', (code, signal) => {
      finish({ code, signal, timedOut: false });
    });
    if (options.stdin !== undefined) child.stdin?.end(options.stdin);
    else child.stdin?.end();
    timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({
        code: null,
        signal: 'SIGTERM',
        error: `Process timed out after ${options.timeoutMs ?? 10_000}ms`,
        timedOut: true,
      });
    }, options.timeoutMs ?? 10_000);
    timer.unref?.();
  });
}

async function runCompatibilityProbe(
  executable: string,
  probe: RuntimeProbeDescriptor,
  env: NodeJS.ProcessEnv
): Promise<ProcessResult> {
  if (probe.kind === 'command') {
    return await runProcess(executable, probe.args, {
      env,
      timeoutMs: probe.timeoutMs ?? 10_000,
    });
  }
  const request = `${JSON.stringify({
    id: 1,
    method: 'initialize',
    params: { clientInfo: { name: 'zclaudia-managed-runtime', version: '1' } },
  })}\n`;
  const result = await runProcess(executable, probe.args, {
    env,
    timeoutMs: probe.timeoutMs ?? 10_000,
    stdin: request,
  });
  if (result.code !== 0 && !/"id"\s*:\s*1/.test(result.stdout)) return result;
  if (!/"id"\s*:\s*1/.test(result.stdout) || !/"result"\s*:/.test(result.stdout)) {
    return {
      ...result,
      code: result.code ?? 1,
      error: 'JSON-RPC initialize did not return a result.',
    };
  }
  return { ...result, code: 0, error: undefined };
}

function parseVersion(
  output: string,
  descriptor: RuntimeCompatibilityDescriptor
): string | undefined {
  const pattern = descriptor.executable.versionPattern
    ? new RegExp(descriptor.executable.versionPattern, 'm')
    : /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;
  return pattern.exec(output)?.[1];
}

async function executableExists(executablePath: string): Promise<boolean> {
  try {
    await access(
      executablePath,
      process.platform === 'win32' ? constants.F_OK : constants.F_OK | constants.X_OK
    );
    return true;
  } catch {
    return false;
  }
}

function findExecutable(
  command: string,
  pathValue: string | undefined,
  platform: NodeJS.Platform
): string | undefined {
  if (path.isAbsolute(command)) return existsSync(command) ? command : undefined;
  if (!pathValue) return undefined;
  const delimiter = platform === 'win32' ? ';' : ':';
  const extensions =
    platform === 'win32'
      ? splitEnvList((process.env.PATHEXT ?? '.EXE,.CMD,.BAT,.COM').replaceAll(';', ','))
      : [''];
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const pending = `${filePath}.pending-${randomUUID()}`;
  const backup = `${filePath}.backup-${randomUUID()}`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(pending, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  let backedUp = false;
  try {
    if (existsSync(filePath)) {
      await rename(filePath, backup);
      backedUp = true;
    }
    await rename(pending, filePath);
  } catch (error) {
    await rm(pending, { force: true });
    if (backedUp && !existsSync(filePath)) await rename(backup, filePath).catch(() => {});
    throw error;
  }
  await rm(backup, { force: true }).catch(() => {});
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function validateProvenanceDocument(
  data: Buffer,
  artifactSha256: string,
  expectedPredicateType?: string
): void {
  let documents: unknown[];
  const source = data.toString('utf8');
  try {
    documents = [JSON.parse(source) as unknown];
  } catch {
    try {
      documents = source
        .split(/\r?\n/)
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line) as unknown);
    } catch (error) {
      throw new Error('Managed runtime provenance is not valid JSON or JSONL', { cause: error });
    }
  }

  const digest = artifactSha256.toLowerCase();
  let digestBound = false;
  let predicateMatched = expectedPredicateType === undefined;
  const pending = [...documents];
  let visited = 0;
  while (pending.length > 0) {
    if ((visited += 1) > 100_000) {
      throw new Error('Managed runtime provenance document is too complex');
    }
    const value = pending.pop();
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      if (normalized === digest || normalized === `sha256:${digest}`) digestBound = true;
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    const record = value as Record<string, unknown>;
    if (record.predicateType === expectedPredicateType) predicateMatched = true;
    for (const entry of Object.values(record)) pending.push(entry);

    // An in-toto DSSE envelope stores its statement as a base64 payload.
    if (typeof record.payload === 'string' && typeof record.payloadType === 'string') {
      try {
        pending.push(JSON.parse(Buffer.from(record.payload, 'base64').toString('utf8')) as unknown);
      } catch {
        throw new Error('Managed runtime provenance DSSE payload is invalid');
      }
    }
  }
  if (!digestBound) {
    throw new Error('Managed runtime provenance does not bind the downloaded artifact SHA-256');
  }
  if (!predicateMatched) {
    throw new Error(
      `Managed runtime provenance predicateType does not match ${expectedPredicateType}`
    );
  }
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
  }): Promise<RuntimeCompatibilityDescriptor | undefined> {
    const descriptor = await readRuntimeCompatibilityDescriptor(
      options.pluginPath,
      options.runtimes
    );
    if (!descriptor) return undefined;
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

  private runtimeDir(
    runtime: string,
    version: string,
    platform: ManagedRuntimePlatformKey
  ): string {
    assertIdentity(runtime, 'runtime');
    if (!VERSION_PATTERN.test(version)) throw new Error('Runtime version is invalid');
    return path.join(this.storeDir, runtime, version, platform);
  }

  private referencePath(pluginId: string, pluginVersion: string): string {
    assertIdentity(pluginId, 'pluginId');
    if (!VERSION_PATTERN.test(pluginVersion)) throw new Error('Plugin version is invalid');
    return path.join(this.refsDir, pluginId, `${pluginVersion}.json`);
  }

  private async readReference(
    registration: RegisteredRuntime
  ): Promise<RuntimeReference | undefined> {
    const ref = await readJson<RuntimeReference>(
      this.referencePath(registration.pluginId, registration.pluginVersion)
    );
    if (
      !ref ||
      ref.schemaVersion !== 1 ||
      ref.pluginId !== registration.pluginId ||
      ref.pluginVersion !== registration.pluginVersion ||
      ref.runtime !== registration.descriptor.runtime ||
      !Array.isArray(ref.versions) ||
      !Array.isArray(ref.selectionHistory)
    ) {
      return undefined;
    }
    return ref;
  }

  private async updateReference(
    registration: RegisteredRuntime,
    version: string,
    select: boolean
  ): Promise<RuntimeReference> {
    const platform = this.platformKey();
    if (!platform) throw new Error(`Unsupported platform ${this.platform}-${this.arch}`);
    const current = await this.readReference(registration);
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
      updatedAt: this.now().toISOString(),
    };
    await writeJsonAtomic(
      this.referencePath(registration.pluginId, registration.pluginVersion),
      next
    );
    return next;
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
      await writeJsonAtomic(this.referencePath(pluginId, pluginVersion), next);
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
    await writeJsonAtomic(this.referencePath(pluginId, pluginVersion), next);
    return next;
  }

  async releasePluginReference(pluginId: string, pluginVersion: string): Promise<void> {
    if (!/^[a-zA-Z0-9_.-]+$/.test(pluginId) || !VERSION_PATTERN.test(pluginVersion)) return;
    await rm(this.referencePath(pluginId, pluginVersion), { force: true });
  }

  private async inspectExecutable(
    executablePath: string,
    descriptor: RuntimeCompatibilityDescriptor,
    runProbe = true
  ): Promise<ExecutableInspection> {
    if (!(await executableExists(executablePath))) {
      return { executablePath, compatibilityState: 'missing', message: 'CLI was not found.' };
    }
    const versionResult = await runProcess(executablePath, descriptor.executable.versionArgs, {
      env: this.env,
      timeoutMs: 8_000,
    });
    if (versionResult.error || versionResult.code !== 0) {
      return {
        executablePath,
        compatibilityState: 'probe-failed',
        message:
          versionResult.error ||
          `Version command exited with status ${String(versionResult.code)}.`,
      };
    }
    const version = parseVersion(`${versionResult.stdout}\n${versionResult.stderr}`, descriptor);
    const compatibility = compatibilityForVersion(version, descriptor);
    if (!usableCompatibility(compatibility.state) || !runProbe) {
      return {
        executablePath,
        version,
        compatibilityState: compatibility.state,
        message: compatibility.message,
      };
    }
    const probe = await runCompatibilityProbe(executablePath, descriptor.probe, this.env);
    if (probe.error || probe.code !== 0) {
      return {
        executablePath,
        version,
        compatibilityState: 'probe-failed',
        message: probe.error || `Compatibility probe exited with status ${String(probe.code)}.`,
        probe,
      };
    }
    return {
      executablePath,
      version,
      compatibilityState: compatibility.state,
      message: compatibility.message,
      probe,
    };
  }

  private async runAuthProbe(
    executablePath: string,
    probe: ManagedRuntimeAuthProbe | undefined
  ): Promise<ManagedRuntimeAuthState> {
    if (!probe) return 'unknown';
    const result = await runProcess(executablePath, probe.args, {
      env: this.env,
      timeoutMs: probe.timeoutMs ?? 10_000,
    });
    if (result.error && result.code === null) return 'probe-failed';
    const output = `${result.stdout}\n${result.stderr}`;
    if (
      probe.unauthenticatedPattern &&
      new RegExp(probe.unauthenticatedPattern, 'm').test(output)
    ) {
      return 'auth-required';
    }
    const successCodes = probe.successExitCodes ?? [0];
    if (!successCodes.includes(result.code ?? -1)) return 'auth-required';
    if (probe.authenticatedPattern && !new RegExp(probe.authenticatedPattern, 'm').test(output)) {
      return 'auth-required';
    }
    return 'authenticated';
  }

  private artifactCandidate(
    registration: RegisteredRuntime,
    requestedVersion?: string
  ):
    | {
        version: string;
        artifact: ManagedRuntimeArtifact;
        authProbe?: ManagedRuntimeAuthProbe;
      }
    | undefined {
    const platform = this.platformKey();
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
    const selected =
      recommended ?? versions.sort((a, b) => compareVersions(b.version, a.version))[0];
    const artifact = selected?.artifacts[platform];
    return selected && artifact
      ? {
          version: selected.version,
          artifact,
          authProbe: selected.authProbe ?? managed.authProbe,
        }
      : undefined;
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

  private installationPath(
    runtime: string,
    version: string,
    platform: ManagedRuntimePlatformKey
  ): string {
    return path.join(this.runtimeDir(runtime, version, platform), INSTALLATION_FILE);
  }

  private async readInstallation(
    runtime: string,
    version: string,
    platform: ManagedRuntimePlatformKey
  ): Promise<(InstallationRecord & { absoluteExecutablePath: string }) | undefined> {
    const root = this.runtimeDir(runtime, version, platform);
    const record = await readJson<InstallationRecord>(
      this.installationPath(runtime, version, platform)
    );
    if (
      !record ||
      record.schemaVersion !== 1 ||
      record.runtime !== runtime ||
      record.version !== version ||
      record.platform !== platform ||
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

  private installationMatchesRegistration(
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

  private async listInstalled(
    registration: RegisteredRuntime
  ): Promise<Array<InstallationRecord & { absoluteExecutablePath: string }>> {
    const platform = this.platformKey();
    if (!platform) return [];
    const runtimeRoot = path.join(this.storeDir, registration.descriptor.runtime);
    const entries = await readdir(runtimeRoot, { withFileTypes: true }).catch(() => []);
    const installed = await Promise.all(
      entries
        .filter(entry => entry.isDirectory() && VERSION_PATTERN.test(entry.name))
        .map(entry => this.readInstallation(registration.descriptor.runtime, entry.name, platform))
    );
    return installed
      .filter(
        (
          entry
        ): entry is InstallationRecord & {
          absoluteExecutablePath: string;
        } => !!entry && this.installationMatchesRegistration(registration, entry)
      )
      .sort((a, b) => compareVersions(b.version, a.version));
  }

  private resolvedFromInspection(options: {
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

  private async resolvedManaged(
    registration: RegisteredRuntime,
    installation: InstallationRecord & { absoluteExecutablePath: string }
  ): Promise<ManagedRuntimeResolution> {
    const inspection = await this.inspectExecutable(
      installation.absoluteExecutablePath,
      registration.descriptor
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
    const authState = await this.runAuthProbe(
      installation.absoluteExecutablePath,
      versionEntry?.authProbe ?? managed?.authProbe
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
      const inspection = await this.inspectExecutable(options.explicitPath.trim(), descriptor);
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
      const inspection = await this.inspectExecutable(systemPath, descriptor);
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
      this.validateDownloadUrl(candidate.artifact.url, settings);
      if (candidate.artifact.provenance) {
        this.validateDownloadUrl(candidate.artifact.provenance.url, settings);
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

  private validateDownloadUrl(urlValue: string, settings: ManagedRuntimeSettings): URL {
    let url: URL;
    try {
      url = new URL(urlValue);
    } catch {
      throw new Error(`Invalid managed runtime download URL: ${urlValue}`);
    }
    if (url.username || url.password) throw new Error('Download URLs may not contain credentials');
    const enterpriseAllowed = settings.enterpriseMirrorOrigins.includes(url.origin);
    if (url.protocol !== 'https:' && !enterpriseAllowed) {
      throw new Error(
        `Managed runtime downloads require HTTPS; ${url.origin} is not a configured enterprise mirror`
      );
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`Unsupported managed runtime URL protocol: ${url.protocol}`);
    }
    return url;
  }

  private async downloadToFile(
    urlValue: string,
    destination: string,
    expectedSha256: string,
    expectedSize: number | undefined,
    maxSize: number
  ): Promise<DownloadResult> {
    const settings = await this.getSettings();
    let url = this.validateDownloadUrl(urlValue, settings);
    let response: Response | undefined;
    for (let redirect = 0; redirect <= 5; redirect += 1) {
      response = await this.fetchImpl(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) throw new Error('Managed runtime redirect is missing Location');
      url = this.validateDownloadUrl(new URL(location, url).toString(), settings);
    }
    if (!response?.ok) {
      throw new Error(`Managed runtime download failed with HTTP ${response?.status ?? 'unknown'}`);
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxSize) {
      throw new Error(`Managed runtime download exceeds ${maxSize} bytes`);
    }
    if (expectedSize !== undefined && contentLength > 0 && contentLength !== expectedSize) {
      throw new Error(
        `Managed runtime download size mismatch: expected ${expectedSize}, got ${contentLength}`
      );
    }
    if (!response.body) throw new Error('Managed runtime download returned an empty body');
    const file = await open(destination, 'wx', 0o600);
    const hash = createHash('sha256');
    let size = 0;
    try {
      for await (const chunkValue of response.body as unknown as AsyncIterable<Uint8Array>) {
        const chunk = Buffer.from(chunkValue);
        size += chunk.length;
        if (size > maxSize) throw new Error(`Managed runtime download exceeds ${maxSize} bytes`);
        hash.update(chunk);
        await file.write(chunk);
      }
    } finally {
      await file.close();
    }
    if (expectedSize !== undefined && size !== expectedSize) {
      throw new Error(
        `Managed runtime download size mismatch: expected ${expectedSize}, got ${size}`
      );
    }
    const sha256 = hash.digest('hex');
    if (sha256 !== expectedSha256.toLowerCase()) {
      throw new Error(
        `Managed runtime SHA-256 mismatch: expected ${expectedSha256.toLowerCase()}, got ${sha256}`
      );
    }
    return { sha256, size, finalUrl: url.toString() };
  }

  private lockPath(runtime: string, version: string, platform: ManagedRuntimePlatformKey): string {
    const name = createHash('sha256').update(`${runtime}\0${version}\0${platform}`).digest('hex');
    return path.join(this.locksDir, `${name}.lock`);
  }

  private async withInstallLock<T>(
    runtime: string,
    version: string,
    platform: ManagedRuntimePlatformKey,
    fn: () => Promise<T>
  ): Promise<T> {
    await mkdir(this.locksDir, { recursive: true });
    const lockPath = this.lockPath(runtime, version, platform);
    const startedAt = Date.now();
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    while (!handle) {
      try {
        handle = await open(lockPath, 'wx', 0o600);
        await handle.writeFile(
          `${JSON.stringify({ pid: process.pid, createdAt: this.now().toISOString() })}\n`
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const details = await stat(lockPath).catch(() => undefined);
        if (details && Date.now() - details.mtimeMs > LOCK_STALE_MS) {
          await rm(lockPath, { force: true });
          continue;
        }
        if (Date.now() - startedAt > LOCK_WAIT_MS) {
          throw new Error(
            `Timed out waiting for managed runtime install lock: ${runtime}@${version}`,
            { cause: error }
          );
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    try {
      return await fn();
    } finally {
      await handle.close().catch(() => {});
      await rm(lockPath, { force: true }).catch(() => {});
    }
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
    return await this.withInstallLock(
      registration.descriptor.runtime,
      version,
      platform,
      async () => {
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

        const stagingRoot = path.join(this.stagingDir, randomUUID());
        const archivePath = path.join(stagingRoot, 'artifact.download');
        const payloadDir = path.join(stagingRoot, 'payload');
        await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
        try {
          const downloaded = await this.downloadToFile(
            candidate.artifact.url,
            archivePath,
            candidate.artifact.sha256,
            candidate.artifact.size,
            MANAGED_RUNTIME_LIMITS.archiveSize
          );
          let signatureVerified: boolean | undefined;
          if (candidate.artifact.signature) {
            const bytes = await readFile(archivePath);
            signatureVerified = verifySignature(
              null,
              bytes,
              candidate.artifact.signature.publicKey,
              Buffer.from(candidate.artifact.signature.value, 'base64')
            );
            if (!signatureVerified)
              throw new Error('Managed runtime signature verification failed');
          }
          let provenanceVerified: boolean | undefined;
          if (candidate.artifact.provenance) {
            const provenancePath = path.join(stagingRoot, 'provenance.download');
            await this.downloadToFile(
              candidate.artifact.provenance.url,
              provenancePath,
              candidate.artifact.provenance.sha256,
              undefined,
              PROVENANCE_SIZE_LIMIT
            );
            validateProvenanceDocument(
              await readFile(provenancePath),
              downloaded.sha256,
              candidate.artifact.provenance.predicateType
            );
            await mkdir(payloadDir, { recursive: true });
            await rename(provenancePath, path.join(payloadDir, 'provenance.json'));
            provenanceVerified = true;
          }
          const executablePath = await extractManagedRuntimeArtifact({
            archivePath,
            archiveFormat: candidate.artifact.archiveFormat,
            destination: payloadDir,
            executablePath: candidate.artifact.executablePath,
          });
          const inspection = await this.inspectExecutable(executablePath, registration.descriptor);
          if (!usableCompatibility(inspection.compatibilityState)) {
            throw new Error(
              inspection.message ??
                `Installed CLI failed compatibility validation (${inspection.compatibilityState})`
            );
          }
          if (inspection.version !== version) {
            throw new Error(
              `Managed runtime version mismatch: metadata declares ${version}, executable reports ${inspection.version ?? 'unknown'}`
            );
          }
          const authState = await this.runAuthProbe(executablePath, candidate.authProbe);
          const finalDir = this.runtimeDir(registration.descriptor.runtime, version, platform);
          const verification: ManagedRuntimeVerification = {
            sha256: downloaded.sha256,
            checksumVerified: true,
            signatureVerified,
            provenanceVerified,
            verifiedAt: this.now().toISOString(),
            sourceUrl: downloaded.finalUrl,
            size: downloaded.size,
            storagePath: finalDir,
          };
          const record: InstallationRecord = {
            schemaVersion: 1,
            runtime: registration.descriptor.runtime,
            version,
            platform,
            executablePath: candidate.artifact.executablePath,
            installedAt: this.now().toISOString(),
            verification,
            authState,
          };
          await writeFile(
            path.join(payloadDir, INSTALLATION_FILE),
            `${JSON.stringify(record, null, 2)}\n`,
            { mode: 0o600 }
          );
          const installed = await this.storeMutationMutex.runExclusive(async () => {
            await mkdir(path.dirname(finalDir), { recursive: true });
            if (existsSync(finalDir)) {
              throw new Error(`Managed runtime destination already exists without a valid record`);
            }
            await rename(payloadDir, finalDir);
            try {
              await this.updateReference(registration, version, pin);
            } catch (error) {
              await rm(finalDir, { force: true, recursive: true });
              throw error;
            }
            return await this.readInstallation(registration.descriptor.runtime, version, platform);
          });
          if (!installed) throw new Error('Managed runtime install record could not be reopened');
          return await this.resolvedManaged(registration, installed);
        } finally {
          await rm(stagingRoot, { force: true, recursive: true }).catch(() => {});
        }
      }
    );
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

  private async collectReferencedInstallations(): Promise<Set<string>> {
    const referenced = new Set<string>();
    const pluginDirs = await readdir(this.refsDir, { withFileTypes: true }).catch(() => []);
    for (const pluginDir of pluginDirs.filter(entry => entry.isDirectory())) {
      const files = await readdir(path.join(this.refsDir, pluginDir.name), {
        withFileTypes: true,
      }).catch(() => []);
      for (const file of files.filter(entry => entry.isFile() && entry.name.endsWith('.json'))) {
        const ref = await readJson<RuntimeReference>(
          path.join(this.refsDir, pluginDir.name, file.name)
        );
        if (
          !ref ||
          ref.schemaVersion !== 1 ||
          typeof ref.runtime !== 'string' ||
          !/^[a-zA-Z0-9_.-]+$/.test(ref.runtime) ||
          !MANAGED_RUNTIME_PLATFORM_KEYS.includes(ref.platform) ||
          !Array.isArray(ref.versions)
        ) {
          continue;
        }
        for (const version of ref.versions) {
          if (!VERSION_PATTERN.test(version)) continue;
          referenced.add(path.resolve(this.runtimeDir(ref.runtime, version, ref.platform)));
        }
      }
    }
    return referenced;
  }

  async garbageCollect(options: { graceMs?: number } = {}): Promise<{ removed: string[] }> {
    return await this.storeMutationMutex.runExclusive(async () => {
      return await this.garbageCollectUnlocked(options);
    });
  }

  private async garbageCollectUnlocked(
    options: { graceMs?: number } = {}
  ): Promise<{ removed: string[] }> {
    const referenced = await this.collectReferencedInstallations();
    const graceMs = options.graceMs ?? this.gcGraceMs;
    const removed: string[] = [];
    const runtimeDirs = await readdir(this.storeDir, { withFileTypes: true }).catch(() => []);
    for (const runtimeDir of runtimeDirs.filter(entry => entry.isDirectory())) {
      const versionDirs = await readdir(path.join(this.storeDir, runtimeDir.name), {
        withFileTypes: true,
      }).catch(() => []);
      for (const versionDir of versionDirs.filter(entry => entry.isDirectory())) {
        const platformDirs = await readdir(
          path.join(this.storeDir, runtimeDir.name, versionDir.name),
          { withFileTypes: true }
        ).catch(() => []);
        for (const platformDir of platformDirs.filter(entry => entry.isDirectory())) {
          const candidate = path.resolve(
            this.storeDir,
            runtimeDir.name,
            versionDir.name,
            platformDir.name
          );
          if (referenced.has(candidate)) continue;
          const storeRoot = path.resolve(this.storeDir);
          if (!candidate.startsWith(`${storeRoot}${path.sep}`)) continue;
          const details = await stat(candidate).catch(() => undefined);
          if (!details || this.now().getTime() - details.mtimeMs < graceMs) continue;
          await rm(candidate, { recursive: true, force: true });
          removed.push(candidate);
        }
      }
    }
    return { removed };
  }
}

export const managedRuntimeService = new ManagedRuntimeService();

export type { ManagedInstallDescriptor };
