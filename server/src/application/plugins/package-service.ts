import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants as fsConstants } from 'node:fs';
import { accessSync, existsSync, readFileSync, statSync } from 'node:fs';
import { cp, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import {
  validatePluginManifest,
  type Permission,
  type PluginManifest,
} from '@zclaudia/shared/plugin-types';
import { checkPluginCompatibility } from '../../utils/version.js';
import { pluginLoader, type PluginLoader } from './loader.js';
import {
  extractPluginArchive,
  PLUGIN_PACKAGE_LIMITS,
  readPluginArchive,
  resolveSafeLinkTarget,
  type PluginArchiveEntry,
} from './package-archive.js';

const STATE_FILE = 'install-state.json';
const STAGED_PACKAGE_TTL_MS = 15 * 60 * 1000;
const FORBIDDEN_COMPONENTS = new Set([
  '.cache',
  '.git',
  '__tests__',
  'coverage',
  'src',
  'test',
  'tests',
]);
const RUNTIME_JAVASCRIPT_EXTENSIONS = new Set(['.cjs', '.js', '.mjs']);
const POTENTIAL_SECRET_EXTENSIONS = new Set(['.key', '.p12', '.pem', '.pfx']);
const NATIVE_EXTENSIONS = new Set(['.dll', '.dylib', '.exe', '.node', '.so']);

const OFFICIAL_EXECUTABLES: Record<string, string> = {
  'com.zclaudia.claude': 'claude',
  'com.zclaudia.codex': 'codex',
  'com.zclaudia.cursor': 'cursor-agent',
};

interface InstalledVersionRecord {
  version: string;
  installedAt: string;
  sha256: string;
  size: number;
  originalFileName: string;
}

interface PluginInstallState {
  schemaVersion: 1;
  pluginId: string;
  activeVersion: string;
  updatedAt: string;
  versions: InstalledVersionRecord[];
}

interface StagedPackage {
  token: string;
  directory: string;
  manifest: PluginManifest;
  sha256: string;
  size: number;
  fileName: string;
  fileCount: number;
  unpackedSize: number;
  warnings: string[];
  requirements: PluginExecutableRequirement[];
  expiresAt: number;
}

export interface PluginExecutableRequirement {
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
  requirements: PluginExecutableRequirement[];
  warnings: string[];
  action: 'install' | 'update' | 'reinstall';
  currentVersion?: string;
  expiresAt: string;
}

export interface ManagedPluginInfo {
  source: 'managed' | 'development';
  installedAt?: string;
  updatedAt?: string;
  activeVersion?: string;
  availableVersions: string[];
  canRollback: boolean;
  requirements: PluginExecutableRequirement[];
}

export interface PluginPackageMutationResult {
  id: string;
  version?: string;
  activeVersion?: string;
  inactive: true;
}

export class PluginPackageError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'PluginPackageError';
  }
}

export interface PluginPackageServiceOptions {
  dataDir?: string;
  loader?: PluginLoader;
  now?: () => Date;
  stagedPackageTtlMs?: number;
}

export function resolvePluginDataDir(): string {
  return process.env.ZCLAUDIA_DATA_DIR
    ? path.resolve(process.env.ZCLAUDIA_DATA_DIR)
    : path.join(os.homedir(), '.zclaudia');
}

function parseJson<T>(data: Buffer, description: string): T {
  try {
    return JSON.parse(data.toString('utf8')) as T;
  } catch (error) {
    throw new PluginPackageError(
      400,
      'INVALID_PACKAGE',
      `${description} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function isSafeRelativeFile(relativePath: string): boolean {
  return (
    !!relativePath &&
    !relativePath.includes('\\') &&
    !path.posix.isAbsolute(relativePath) &&
    relativePath.split('/').every(component => component !== '' && component !== '..')
  );
}

function hasNativeMagic(data: Buffer): boolean {
  if (data.length >= 4) {
    if (data[0] === 0x7f && data.subarray(1, 4).toString('ascii') === 'ELF') return true;
    const magic = data.readUInt32BE(0);
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic)) {
      return true;
    }
  }
  return data.length >= 2 && data[0] === 0x4d && data[1] === 0x5a;
}

async function sha256(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('error', reject);
    input.on('data', chunk => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function findExecutable(name: string): string | undefined {
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : [''];
  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      try {
        accessSync(candidate, fsConstants.X_OK);
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Keep searching PATH.
      }
    }
  }
  return undefined;
}

function executableRequirements(manifest: PluginManifest): PluginExecutableRequirement[] {
  const official = OFFICIAL_EXECUTABLES[manifest.id];
  const names = new Map<string, 'manifest' | 'official'>();
  if (official) names.set(official, 'official');

  const runtimes = manifest.contributes?.agentRuntimes ?? [];
  for (const runtime of runtimes) {
    if (!runtime.hasCliPath || official) continue;
    names.set(runtime.type, 'manifest');
  }

  return [...names.entries()].map(([name, source]) => {
    const executablePath = findExecutable(name);
    return { name, found: executablePath !== undefined, path: executablePath, source };
  });
}

function validateArchiveEntries(entries: PluginArchiveEntry[]): {
  manifest: PluginManifest;
  warnings: string[];
  unpackedSize: number;
} {
  const entryByName = new Map(entries.map(entry => [entry.name, entry]));
  const manifestEntry = entryByName.get('plugin.json');
  if (!manifestEntry || manifestEntry.type !== 'file') {
    throw new PluginPackageError(
      400,
      'INVALID_PACKAGE',
      'plugin.json must exist at the archive root'
    );
  }

  const manifest = parseJson<PluginManifest>(manifestEntry.data, 'plugin.json');
  const validation = validatePluginManifest(manifest);
  if (!validation.valid) {
    throw new PluginPackageError(
      400,
      'INVALID_MANIFEST',
      'plugin.json failed validation',
      validation.errors
    );
  }

  const compatibility = checkPluginCompatibility(manifest.engines);
  if (!compatibility.compatible) {
    throw new PluginPackageError(
      400,
      'INCOMPATIBLE_HOST',
      compatibility.error ?? 'Plugin is not compatible with this ZClaudia version'
    );
  }

  const warnings = [...validation.warnings];
  let unpackedSize = 0;
  let containsNativeCode = false;
  for (const entry of entries) {
    unpackedSize += entry.size;
    const components = entry.name.split('/');
    const inDependencies = components[0] === 'node_modules';
    if (!inDependencies && components.some(component => FORBIDDEN_COMPONENTS.has(component))) {
      throw new PluginPackageError(
        400,
        'INVALID_PACKAGE',
        `Development-only path is not allowed: ${entry.name}`
      );
    }

    const basename = components.at(-1) ?? entry.name;
    if (basename === '.DS_Store' || basename === '.env' || basename.startsWith('.env.')) {
      throw new PluginPackageError(
        400,
        'INVALID_PACKAGE',
        `Environment or cache file is not allowed: ${entry.name}`
      );
    }
    const extension = path.posix.extname(basename).toLowerCase();
    if (POTENTIAL_SECRET_EXTENSIONS.has(extension)) {
      throw new PluginPackageError(
        400,
        'INVALID_PACKAGE',
        `Potential secret/key file is not allowed: ${entry.name}`
      );
    }
    if (NATIVE_EXTENSIONS.has(extension) || (entry.type === 'file' && hasNativeMagic(entry.data))) {
      containsNativeCode = true;
    }
    if (entry.type === 'symlink') {
      if (entry.target === undefined) {
        throw new PluginPackageError(
          400,
          'INVALID_PACKAGE',
          `Symlink target is missing: ${entry.name}`
        );
      }
      const resolvedTarget = resolveSafeLinkTarget(entry.name, entry.target);
      const targetExists =
        entryByName.has(resolvedTarget) ||
        entries.some(candidate => candidate.name.startsWith(`${resolvedTarget}/`));
      if (!targetExists) {
        throw new PluginPackageError(
          400,
          'INVALID_PACKAGE',
          `Symlink target is missing: ${entry.name} -> ${entry.target}`
        );
      }
    }
    if (RUNTIME_JAVASCRIPT_EXTENSIONS.has(extension) && entry.type === 'file') {
      if (/['"]@zclaudia\/shared(?:\/[^'"]*)?['"]/.test(entry.data.toString('utf8'))) {
        throw new PluginPackageError(
          400,
          'INVALID_PACKAGE',
          `Runtime JavaScript imports host-internal @zclaudia/shared: ${entry.name}`
        );
      }
    }
    if (basename === 'package.json' && entry.type === 'file') {
      const packageJson = parseJson<Record<string, unknown>>(entry.data, entry.name);
      for (const sectionName of [
        'dependencies',
        'optionalDependencies',
        'peerDependencies',
        'devDependencies',
      ]) {
        const section = packageJson[sectionName];
        if (!section || typeof section !== 'object') continue;
        for (const value of Object.values(section)) {
          if (typeof value === 'string' && value.startsWith('workspace:')) {
            throw new PluginPackageError(
              400,
              'INVALID_PACKAGE',
              `Workspace dependency found in ${entry.name}`
            );
          }
        }
      }
      if (entry.name === 'package.json') {
        const version = packageJson.version;
        if (typeof version === 'string' && version !== manifest.version) {
          throw new PluginPackageError(
            400,
            'INVALID_PACKAGE',
            `package.json version ${version} does not match plugin version ${manifest.version}`
          );
        }
      }
    }
  }

  if (!manifest.main && !manifest.frontend) {
    warnings.push('Plugin declares no main or frontend entrypoint.');
  }
  for (const [label, entrypoint] of [
    ['main', manifest.main],
    ['frontend', manifest.frontend],
  ] as const) {
    if (!entrypoint) continue;
    if (!isSafeRelativeFile(entrypoint)) {
      throw new PluginPackageError(
        400,
        'INVALID_MANIFEST',
        `plugin.json ${label} path is unsafe: ${entrypoint}`
      );
    }
    const entry = entryByName.get(entrypoint);
    if (!entry || entry.type !== 'file') {
      throw new PluginPackageError(
        400,
        'INVALID_PACKAGE',
        `${label} entrypoint does not exist: ${entrypoint}`
      );
    }
  }
  if (!manifest.engines?.claudia) {
    warnings.push('Plugin does not declare a ZClaudia compatibility range.');
  }
  if (containsNativeCode) {
    warnings.push('Plugin contains native code; confirm that the package matches this platform.');
  }

  return { manifest, warnings, unpackedSize };
}

export class PluginPackageService {
  private readonly dataDir: string;
  private readonly pluginsDir: string;
  private readonly storeDir: string;
  private readonly stagingDir: string;
  private readonly loader: PluginLoader;
  private readonly now: () => Date;
  private readonly stagedPackageTtlMs: number;
  private readonly stagedPackages = new Map<string, StagedPackage>();
  private readonly mutationMutex = new Mutex();
  private readonly stagingReady: Promise<void>;

  constructor(options: PluginPackageServiceOptions = {}) {
    this.dataDir = options.dataDir ? path.resolve(options.dataDir) : resolvePluginDataDir();
    this.pluginsDir = path.join(this.dataDir, 'plugins');
    this.storeDir = path.join(this.dataDir, 'plugin-store');
    this.stagingDir = path.join(this.dataDir, 'plugin-staging');
    this.loader = options.loader ?? pluginLoader;
    this.now = options.now ?? (() => new Date());
    this.stagedPackageTtlMs = options.stagedPackageTtlMs ?? STAGED_PACKAGE_TTL_MS;
    // Preview tokens are process-local. A restart invalidates every token, so
    // remove orphaned extractions before this service accepts a new preview.
    this.stagingReady = rm(this.stagingDir, { force: true, recursive: true }).then(async () => {
      await mkdir(this.stagingDir, { recursive: true });
    });
  }

  async inspectPackage(
    archivePath: string,
    originalFileName: string
  ): Promise<PluginPackagePreview> {
    await this.stagingReady;
    await this.cleanupExpiredStaging();
    const details = await stat(archivePath).catch(() => undefined);
    if (!details?.isFile()) {
      throw new PluginPackageError(400, 'INVALID_INPUT', 'A .zplugin file is required');
    }
    if (!originalFileName.toLowerCase().endsWith('.zplugin')) {
      throw new PluginPackageError(400, 'INVALID_INPUT', 'Plugin package must use .zplugin');
    }
    if (details.size > PLUGIN_PACKAGE_LIMITS.archiveSize) {
      throw new PluginPackageError(
        413,
        'PACKAGE_TOO_LARGE',
        `Plugin package exceeds ${PLUGIN_PACKAGE_LIMITS.archiveSize} bytes`
      );
    }

    let entries: PluginArchiveEntry[];
    try {
      entries = await readPluginArchive(archivePath);
    } catch (error) {
      if (error instanceof PluginPackageError) throw error;
      throw new PluginPackageError(
        400,
        'INVALID_PACKAGE',
        error instanceof Error ? error.message : String(error)
      );
    }

    const validated = validateArchiveEntries(entries);
    const requirements = executableRequirements(validated.manifest);
    const warnings = [...validated.warnings];
    for (const requirement of requirements) {
      if (!requirement.found) {
        warnings.push(
          `${requirement.name} was not found on PATH. You can install the plugin now, but activation may fail.`
        );
      }
    }

    const existing = this.loader.getPlugin(validated.manifest.id);
    if (existing && !this.isManagedPath(validated.manifest.id, existing.path)) {
      throw new PluginPackageError(
        409,
        'DEVELOPMENT_PLUGIN_CONFLICT',
        `A development plugin with this id is already loaded from ${existing.path}`
      );
    }

    const token = randomUUID();
    const directory = path.join(this.stagingDir, token);
    await mkdir(this.stagingDir, { recursive: true });
    await extractPluginArchive(entries, directory);
    const digest = await sha256(archivePath);
    const expiresAt = this.now().getTime() + this.stagedPackageTtlMs;
    const currentVersion = existing?.manifest.version;
    const staged: StagedPackage = {
      token,
      directory,
      manifest: validated.manifest,
      sha256: digest,
      size: details.size,
      fileName: path.basename(originalFileName),
      fileCount: entries.length,
      unpackedSize: validated.unpackedSize,
      warnings,
      requirements,
      expiresAt,
    };
    this.stagedPackages.set(token, staged);

    return {
      token,
      fileName: staged.fileName,
      size: staged.size,
      sha256: staged.sha256,
      fileCount: staged.fileCount,
      unpackedSize: staged.unpackedSize,
      manifest: staged.manifest,
      permissions: staged.manifest.permissions ?? [],
      requirements: staged.requirements,
      warnings: staged.warnings,
      action: currentVersion
        ? currentVersion === staged.manifest.version
          ? 'reinstall'
          : 'update'
        : 'install',
      currentVersion,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async installPackage(token: string): Promise<PluginPackageMutationResult> {
    return await this.mutationMutex.runExclusive(async () => {
      await this.cleanupExpiredStaging();
      const staged = this.stagedPackages.get(token);
      if (!staged) {
        throw new PluginPackageError(
          404,
          'PACKAGE_PREVIEW_EXPIRED',
          'Plugin package preview expired; choose the file again'
        );
      }

      const id = staged.manifest.id;
      const version = staged.manifest.version;
      const existing = this.loader.getPlugin(id);
      if (existing && !this.isManagedPath(id, existing.path)) {
        throw new PluginPackageError(
          409,
          'DEVELOPMENT_PLUGIN_CONFLICT',
          `A development plugin with this id is loaded from ${existing.path}`
        );
      }

      const previousState = this.readState(id);
      if (!previousState && existsSync(this.activePluginDir(id))) {
        throw new PluginPackageError(
          409,
          'UNMANAGED_DIRECTORY_CONFLICT',
          `An unmanaged plugin directory already exists at ${this.activePluginDir(id)}`
        );
      }
      const existingVersion = previousState?.versions.find(item => item.version === version);
      if (existingVersion && existingVersion.sha256 !== staged.sha256) {
        throw new PluginPackageError(
          409,
          'VERSION_CONFLICT',
          `Version ${version} is already installed with a different checksum`
        );
      }

      const pluginStoreDir = path.join(this.storeDir, id);
      const versionDir = path.join(pluginStoreDir, version);
      await mkdir(pluginStoreDir, { recursive: true });
      if (!existingVersion) {
        if (existsSync(versionDir)) {
          throw new PluginPackageError(
            409,
            'VERSION_CONFLICT',
            `Version directory already exists without matching installation metadata: ${version}`
          );
        }
        await rename(staged.directory, versionDir);
      } else {
        await rm(staged.directory, { force: true, recursive: true });
      }
      this.stagedPackages.delete(token);

      const timestamp = this.now().toISOString();
      const versions = existingVersion
        ? (previousState?.versions ?? [])
        : [
            ...(previousState?.versions ?? []),
            {
              version,
              installedAt: timestamp,
              sha256: staged.sha256,
              size: staged.size,
              originalFileName: staged.fileName,
            },
          ];
      const state: PluginInstallState = {
        schemaVersion: 1,
        pluginId: id,
        activeVersion: version,
        updatedAt: timestamp,
        versions,
      };
      try {
        await this.selectVersion(id, version);
        await this.writeState(state);
      } catch (error) {
        if (previousState) {
          await this.selectVersion(id, previousState.activeVersion).catch(() => {});
        } else {
          await this.loader.remove(id).catch(() => false);
          await rm(this.activePluginDir(id), { force: true, recursive: true });
        }
        if (!existingVersion) await rm(versionDir, { force: true, recursive: true });
        throw error;
      }
      return { id, version, activeVersion: version, inactive: true };
    });
  }

  async rollbackPlugin(
    id: string,
    requestedVersion?: string
  ): Promise<PluginPackageMutationResult> {
    return await this.mutationMutex.runExclusive(async () => {
      const state = this.requireState(id);
      const candidates = [...state.versions]
        .filter(item => item.version !== state.activeVersion)
        .sort((left, right) => right.installedAt.localeCompare(left.installedAt));
      const version = requestedVersion ?? candidates[0]?.version;
      if (!version || !state.versions.some(item => item.version === version)) {
        throw new PluginPackageError(
          400,
          'ROLLBACK_UNAVAILABLE',
          'No rollback version is available'
        );
      }
      if (version === state.activeVersion) {
        throw new PluginPackageError(
          400,
          'ALREADY_SELECTED',
          `Version ${version} is already selected`
        );
      }

      const previousVersion = state.activeVersion;
      await this.selectVersion(id, version);
      state.activeVersion = version;
      state.updatedAt = this.now().toISOString();
      try {
        await this.writeState(state);
      } catch (error) {
        state.activeVersion = previousVersion;
        await this.selectVersion(id, previousVersion).catch(() => {});
        throw error;
      }
      return { id, activeVersion: version, inactive: true };
    });
  }

  async uninstallPlugin(id: string): Promise<PluginPackageMutationResult> {
    return await this.mutationMutex.runExclusive(async () => {
      this.requireState(id);
      await this.loader.remove(id);
      await rm(this.activePluginDir(id), { force: true, recursive: true });
      await rm(path.join(this.storeDir, id), { force: true, recursive: true });
      return { id, inactive: true };
    });
  }

  describePlugin(manifest: PluginManifest, pluginPath: string): ManagedPluginInfo {
    const requirements = executableRequirements(manifest);
    const state = this.readState(manifest.id);
    if (!state || !this.isManagedPath(manifest.id, pluginPath)) {
      let installedAt: string | undefined;
      let updatedAt: string | undefined;
      try {
        const details = statSync(pluginPath);
        installedAt = details.birthtime.toISOString();
        updatedAt = details.mtime.toISOString();
      } catch {
        // The loader remains authoritative if a development directory disappears.
      }
      return {
        source: 'development',
        installedAt,
        updatedAt,
        availableVersions: [],
        canRollback: false,
        requirements,
      };
    }

    const activeRecord = state.versions.find(item => item.version === state.activeVersion);
    return {
      source: 'managed',
      installedAt: activeRecord?.installedAt,
      updatedAt: state.updatedAt,
      activeVersion: state.activeVersion,
      availableVersions: state.versions
        .map(item => item.version)
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true })),
      canRollback: state.versions.some(item => item.version !== state.activeVersion),
      requirements,
    };
  }

  private async selectVersion(id: string, version: string): Promise<void> {
    const versionDir = path.join(this.storeDir, id, version);
    if (!existsSync(versionDir)) {
      throw new PluginPackageError(
        404,
        'VERSION_NOT_FOUND',
        `Plugin version not found: ${version}`
      );
    }

    const activeDir = this.activePluginDir(id);
    const pendingDir = `${activeDir}.pending-${randomUUID()}`;
    const backupDir = `${activeDir}.backup-${randomUUID()}`;
    await mkdir(this.pluginsDir, { recursive: true });
    await cp(versionDir, pendingDir, { recursive: true, verbatimSymlinks: true });

    const loaded = this.loader.getPlugin(id);
    if (loaded && path.resolve(loaded.path) !== this.activePluginDir(id)) {
      await rm(pendingDir, { force: true, recursive: true });
      throw new PluginPackageError(
        409,
        'DEVELOPMENT_PLUGIN_CONFLICT',
        `A development plugin with this id is loaded from ${loaded.path}`
      );
    }
    if (loaded) await this.loader.remove(id);

    let backedUp = false;
    try {
      if (existsSync(activeDir)) {
        await rename(activeDir, backupDir);
        backedUp = true;
      }
      await rename(pendingDir, activeDir);
      await this.loader.discover();
      const discovered = this.loader.getPlugin(id);
      if (!discovered || path.resolve(discovered.path) !== path.resolve(activeDir)) {
        throw new Error(`Installed plugin was not rediscovered at ${activeDir}`);
      }
      await rm(backupDir, { force: true, recursive: true });
    } catch (error) {
      await this.loader.remove(id).catch(() => false);
      await rm(activeDir, { force: true, recursive: true });
      if (backedUp && existsSync(backupDir)) await rename(backupDir, activeDir);
      await rm(pendingDir, { force: true, recursive: true });
      if (backedUp) await this.loader.discover().catch(() => []);
      throw new PluginPackageError(
        500,
        'INSTALLATION_FAILED',
        `Could not select plugin version ${version}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private activePluginDir(id: string): string {
    return path.join(this.pluginsDir, id);
  }

  private statePath(id: string): string {
    return path.join(this.storeDir, id, STATE_FILE);
  }

  private isManagedPath(id: string, pluginPath: string): boolean {
    return (
      this.readState(id) !== undefined && path.resolve(pluginPath) === this.activePluginDir(id)
    );
  }

  private readState(id: string): PluginInstallState | undefined {
    try {
      const parsed = JSON.parse(readFileSync(this.statePath(id), 'utf8')) as PluginInstallState;
      if (
        parsed.schemaVersion !== 1 ||
        parsed.pluginId !== id ||
        typeof parsed.activeVersion !== 'string' ||
        !Array.isArray(parsed.versions)
      ) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  private requireState(id: string): PluginInstallState {
    const state = this.readState(id);
    if (!state) {
      throw new PluginPackageError(400, 'NOT_MANAGED', `Plugin is not package-managed: ${id}`);
    }
    return state;
  }

  private async writeState(state: PluginInstallState): Promise<void> {
    const statePath = this.statePath(state.pluginId);
    const pending = `${statePath}.pending-${randomUUID()}`;
    const backup = `${statePath}.backup-${randomUUID()}`;
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(pending, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    let backedUp = false;
    try {
      if (existsSync(statePath)) {
        await rename(statePath, backup);
        backedUp = true;
      }
      await rename(pending, statePath);
    } catch (error) {
      await rm(pending, { force: true });
      if (backedUp && !existsSync(statePath)) await rename(backup, statePath).catch(() => {});
      throw error;
    }
    await rm(backup, { force: true }).catch(() => {});
  }

  private async cleanupExpiredStaging(): Promise<void> {
    const now = this.now().getTime();
    const expired = [...this.stagedPackages.values()].filter(item => item.expiresAt <= now);
    for (const staged of expired) {
      this.stagedPackages.delete(staged.token);
      await rm(staged.directory, { force: true, recursive: true });
    }
  }
}

export const pluginPackageService = new PluginPackageService();
