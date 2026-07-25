import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ManagedInstallDescriptor,
  ManagedRuntimeArtifact,
  ManagedRuntimeAuthProbe,
  ManagedRuntimePlatformKey,
  RuntimeCompatibilityDescriptor,
} from '@zclaudia/shared/plugins/managed-runtimes';
import { MANAGED_RUNTIME_PLATFORM_KEYS } from '@zclaudia/shared/plugins/managed-runtimes';

export const RUNTIME_COMPATIBILITY_FILE = 'runtime-compatibility.json';
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;
const PLATFORM_KEYS = new Set<string>(MANAGED_RUNTIME_PLATFORM_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertDescriptor(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid ${RUNTIME_COMPATIBILITY_FILE}: ${message}`);
}

function isStringArray(value: unknown, allowEmpty = false): value is string[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every(item => typeof item === 'string' && (allowEmpty || item.length > 0))
  );
}

export function assertSafeRuntimeRelativePath(value: string, label: string): void {
  assertDescriptor(value.length > 0, `${label} must not be empty`);
  assertDescriptor(!value.includes('\\') && !value.includes('\0'), `${label} is unsafe`);
  assertDescriptor(!path.posix.isAbsolute(value), `${label} must be relative`);
  const parts = value.split('/');
  assertDescriptor(
    parts.every(part => part !== '' && part !== '.' && part !== '..'),
    `${label} is unsafe`
  );
  assertDescriptor(!/^[A-Za-z]:/.test(parts[0]), `${label} is unsafe`);
}

function validateAuthProbe(value: unknown, label: string): ManagedRuntimeAuthProbe {
  assertDescriptor(isRecord(value), `${label} must be an object`);
  assertDescriptor(isStringArray(value.args, true), `${label}.args must be a string array`);
  if (value.timeoutMs !== undefined) {
    assertDescriptor(
      Number.isSafeInteger(value.timeoutMs) && Number(value.timeoutMs) > 0,
      `${label}.timeoutMs must be a positive integer`
    );
  }
  if (value.successExitCodes !== undefined) {
    assertDescriptor(
      Array.isArray(value.successExitCodes) &&
        value.successExitCodes.length > 0 &&
        value.successExitCodes.every(Number.isSafeInteger),
      `${label}.successExitCodes must be a non-empty integer array`
    );
  }
  for (const key of ['authenticatedPattern', 'unauthenticatedPattern'] as const) {
    if (value[key] === undefined) continue;
    assertDescriptor(typeof value[key] === 'string', `${label}.${key} must be a string`);
    try {
      new RegExp(value[key] as string);
    } catch {
      throw new Error(`Invalid ${RUNTIME_COMPATIBILITY_FILE}: ${label}.${key} is invalid`);
    }
  }
  return value as unknown as ManagedRuntimeAuthProbe;
}

function validateArtifactUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${RUNTIME_COMPATIBILITY_FILE}: ${label} is invalid`);
  }
  assertDescriptor(!url.username && !url.password, `${label} may not contain credentials`);
  assertDescriptor(
    url.protocol === 'https:' || url.protocol === 'http:',
    `${label} must use HTTPS or an enterprise HTTP mirror`
  );
}

function validateArtifact(value: unknown, label: string): ManagedRuntimeArtifact {
  assertDescriptor(isRecord(value), `${label} must be an object`);
  assertDescriptor(
    typeof value.url === 'string' && value.url.length > 0,
    `${label}.url is required`
  );
  validateArtifactUrl(value.url as string, `${label}.url`);
  assertDescriptor(
    typeof value.sha256 === 'string' && SHA256_PATTERN.test(value.sha256),
    `${label}.sha256 must be a 64-character SHA-256 digest`
  );
  assertDescriptor(
    value.archiveFormat === 'raw' ||
      value.archiveFormat === 'zip' ||
      value.archiveFormat === 'tar.gz',
    `${label}.archiveFormat must be raw, zip, or tar.gz`
  );
  assertDescriptor(
    typeof value.executablePath === 'string',
    `${label}.executablePath must be a string`
  );
  assertSafeRuntimeRelativePath(value.executablePath as string, `${label}.executablePath`);
  if (value.size !== undefined) {
    assertDescriptor(
      Number.isSafeInteger(value.size) && Number(value.size) > 0,
      `${label}.size must be a positive integer`
    );
  }
  if (value.signature !== undefined) {
    assertDescriptor(isRecord(value.signature), `${label}.signature must be an object`);
    assertDescriptor(
      value.signature.algorithm === 'ed25519',
      `${label}.signature.algorithm must be ed25519`
    );
    assertDescriptor(
      typeof value.signature.publicKey === 'string' && value.signature.publicKey.length > 0,
      `${label}.signature.publicKey is required`
    );
    assertDescriptor(
      typeof value.signature.value === 'string' && value.signature.value.length > 0,
      `${label}.signature.value is required`
    );
  }
  if (value.provenance !== undefined) {
    assertDescriptor(isRecord(value.provenance), `${label}.provenance must be an object`);
    assertDescriptor(
      typeof value.provenance.url === 'string' && value.provenance.url.length > 0,
      `${label}.provenance.url is required`
    );
    validateArtifactUrl(value.provenance.url as string, `${label}.provenance.url`);
    assertDescriptor(
      typeof value.provenance.sha256 === 'string' && SHA256_PATTERN.test(value.provenance.sha256),
      `${label}.provenance.sha256 must be a SHA-256 digest`
    );
    if (value.provenance.predicateType !== undefined) {
      assertDescriptor(
        typeof value.provenance.predicateType === 'string',
        `${label}.provenance.predicateType must be a string`
      );
    }
  }
  return value as unknown as ManagedRuntimeArtifact;
}

function validateManagedInstall(value: unknown): ManagedInstallDescriptor {
  assertDescriptor(isRecord(value), 'managedInstall must be an object');
  assertDescriptor(Array.isArray(value.versions), 'managedInstall.versions must be an array');
  const versions = new Set<string>();
  for (const [index, entry] of value.versions.entries()) {
    const label = `managedInstall.versions[${index}]`;
    assertDescriptor(isRecord(entry), `${label} must be an object`);
    assertDescriptor(
      typeof entry.version === 'string' && VERSION_PATTERN.test(entry.version),
      `${label}.version must be semver`
    );
    assertDescriptor(!versions.has(entry.version as string), `${label}.version is duplicated`);
    versions.add(entry.version as string);
    assertDescriptor(isRecord(entry.artifacts), `${label}.artifacts must be an object`);
    for (const [platform, artifact] of Object.entries(entry.artifacts)) {
      assertDescriptor(
        PLATFORM_KEYS.has(platform),
        `${label}.artifacts.${platform} is unsupported`
      );
      validateArtifact(artifact, `${label}.artifacts.${platform}`);
    }
    if (entry.authProbe !== undefined) validateAuthProbe(entry.authProbe, `${label}.authProbe`);
  }
  if (value.recommendedVersion !== undefined) {
    assertDescriptor(
      typeof value.recommendedVersion === 'string' &&
        VERSION_PATTERN.test(value.recommendedVersion),
      'managedInstall.recommendedVersion must be semver'
    );
    assertDescriptor(
      versions.has(value.recommendedVersion as string),
      'managedInstall.recommendedVersion must name a declared version'
    );
  }
  if (value.authProbe !== undefined) {
    validateAuthProbe(value.authProbe, 'managedInstall.authProbe');
  }
  return value as unknown as ManagedInstallDescriptor;
}

export function validateRuntimeCompatibilityDescriptor(
  value: unknown,
  expectedRuntime?: string
): RuntimeCompatibilityDescriptor {
  assertDescriptor(isRecord(value), 'root must be an object');
  assertDescriptor(value.schemaVersion === 1, 'schemaVersion must be 1');
  assertDescriptor(
    typeof value.runtime === 'string' && /^[a-zA-Z0-9_.-]+$/.test(value.runtime),
    'runtime must be a safe non-empty identifier'
  );
  if (expectedRuntime !== undefined) {
    assertDescriptor(value.runtime === expectedRuntime, 'runtime does not match the contribution');
  }
  assertDescriptor(isRecord(value.executable), 'executable must be an object');
  assertDescriptor(
    typeof value.executable.command === 'string' &&
      /^[a-zA-Z0-9_.-]+$/.test(value.executable.command),
    'executable.command must be a safe command name'
  );
  assertDescriptor(
    isStringArray(value.executable.versionArgs),
    'executable.versionArgs must be a non-empty string array'
  );
  if (value.executable.versionPattern !== undefined) {
    assertDescriptor(
      typeof value.executable.versionPattern === 'string',
      'executable.versionPattern must be a string'
    );
    try {
      new RegExp(value.executable.versionPattern as string);
    } catch {
      throw new Error(
        `Invalid ${RUNTIME_COMPATIBILITY_FILE}: executable.versionPattern is invalid`
      );
    }
  }
  if (value.versionPolicy !== undefined) {
    assertDescriptor(isRecord(value.versionPolicy), 'versionPolicy must be an object');
    for (const key of ['minimum', 'testedMaximum'] as const) {
      const version = value.versionPolicy[key];
      if (version !== undefined) {
        assertDescriptor(
          typeof version === 'string' && VERSION_PATTERN.test(version),
          `versionPolicy.${key} must be semver`
        );
      }
    }
    if (value.versionPolicy.knownIncompatible !== undefined) {
      assertDescriptor(
        Array.isArray(value.versionPolicy.knownIncompatible) &&
          value.versionPolicy.knownIncompatible.every(
            version => typeof version === 'string' && VERSION_PATTERN.test(version)
          ),
        'versionPolicy.knownIncompatible must contain semver versions'
      );
    }
  }
  assertDescriptor(isRecord(value.probe), 'probe must be an object');
  assertDescriptor(
    value.probe.kind === 'command' || value.probe.kind === 'json-rpc',
    'probe.kind must be command or json-rpc'
  );
  assertDescriptor(isStringArray(value.probe.args), 'probe.args must be a non-empty string array');
  if (value.probe.timeoutMs !== undefined) {
    assertDescriptor(
      Number.isSafeInteger(value.probe.timeoutMs) && Number(value.probe.timeoutMs) > 0,
      'probe.timeoutMs must be a positive integer'
    );
  }
  if (value.managedInstall !== undefined) validateManagedInstall(value.managedInstall);
  return value as unknown as RuntimeCompatibilityDescriptor;
}

export async function readRuntimeCompatibilityDescriptor(
  pluginPath: string,
  expectedRuntimes: string[]
): Promise<RuntimeCompatibilityDescriptor | undefined> {
  const filePath = path.join(pluginPath, RUNTIME_COMPATIBILITY_FILE);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  const descriptor = validateRuntimeCompatibilityDescriptor(parsed);
  assertDescriptor(
    expectedRuntimes.includes(descriptor.runtime),
    `runtime ${descriptor.runtime} is not declared by contributes.agentRuntimes`
  );
  return descriptor;
}

export function platformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): ManagedRuntimePlatformKey | undefined {
  const key = `${platform}-${arch}`;
  return PLATFORM_KEYS.has(key) ? (key as ManagedRuntimePlatformKey) : undefined;
}
