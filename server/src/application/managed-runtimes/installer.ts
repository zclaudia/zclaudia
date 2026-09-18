import { createHash, randomUUID, verify as verifySignature } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  ManagedRuntimePlatformKey,
  ManagedRuntimeResolution,
  ManagedRuntimeVerification,
} from '@zclaudia/shared/plugins/managed-runtimes';
import { extractManagedRuntimeArtifact, MANAGED_RUNTIME_LIMITS } from './archive.js';
import { downloadToFile } from './downloader.js';
import { inspectExecutable, runAuthProbe, usableCompatibility } from './process-probe.js';
import { validateProvenanceDocument } from './provenance.js';
import { resolvedManaged } from './resolver.js';
import {
  INSTALLATION_FILE,
  runtimeStoreDir,
  type ArtifactCandidate,
  type InstallationRecord,
  type ManagedRuntimeSettings,
  type RegisteredRuntime,
  type RuntimeReference,
  type StoredInstallation,
} from './types.js';

const LOCK_STALE_MS = 15 * 60 * 1000;
const LOCK_WAIT_MS = 60 * 1000;
const PROVENANCE_SIZE_LIMIT = 8 * 1024 * 1024;

export async function withInstallLock<T>(options: {
  locksDir: string;
  runtime: string;
  version: string;
  platform: ManagedRuntimePlatformKey;
  now: () => Date;
  operation: () => Promise<T>;
}): Promise<T> {
  const { locksDir, runtime, version, platform, now, operation } = options;
  await mkdir(locksDir, { recursive: true });
  const name = createHash('sha256').update(`${runtime}\0${version}\0${platform}`).digest('hex');
  const lockPath = path.join(locksDir, `${name}.lock`);
  const startedAt = Date.now();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  while (!handle) {
    try {
      handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, createdAt: now().toISOString() })}\n`
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
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

export async function stageFreshInstall(options: {
  registration: RegisteredRuntime;
  candidate: ArtifactCandidate;
  version: string;
  platform: ManagedRuntimePlatformKey;
  pin: boolean;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof globalThis.fetch;
  now: () => Date;
  stagingDir: string;
  storeDir: string;
  getSettings: () => Promise<ManagedRuntimeSettings>;
  readInstallation: (
    runtime: string,
    version: string,
    platform: ManagedRuntimePlatformKey
  ) => Promise<StoredInstallation | undefined>;
  updateReference: (
    registration: RegisteredRuntime,
    version: string,
    select: boolean
  ) => Promise<RuntimeReference>;
  runExclusive: <T>(operation: () => Promise<T>) => Promise<T>;
}): Promise<ManagedRuntimeResolution> {
  const {
    registration,
    candidate,
    version,
    platform,
    pin,
    env,
    fetchImpl,
    now,
    stagingDir,
    storeDir,
    getSettings,
    readInstallation,
    updateReference,
    runExclusive,
  } = options;
  const stagingRoot = path.join(stagingDir, randomUUID());
  const archivePath = path.join(stagingRoot, 'artifact.download');
  const payloadDir = path.join(stagingRoot, 'payload');
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  try {
    const downloaded = await downloadToFile({
      fetchImpl,
      getSettings,
      urlValue: candidate.artifact.url,
      destination: archivePath,
      expectedSha256: candidate.artifact.sha256,
      expectedSize: candidate.artifact.size,
      maxSize: MANAGED_RUNTIME_LIMITS.archiveSize,
    });
    let signatureVerified: boolean | undefined;
    if (candidate.artifact.signature) {
      const bytes = await readFile(archivePath);
      signatureVerified = verifySignature(
        null,
        bytes,
        candidate.artifact.signature.publicKey,
        Buffer.from(candidate.artifact.signature.value, 'base64')
      );
      if (!signatureVerified) throw new Error('Managed runtime signature verification failed');
    }
    let provenanceVerified: boolean | undefined;
    if (candidate.artifact.provenance) {
      const provenancePath = path.join(stagingRoot, 'provenance.download');
      await downloadToFile({
        fetchImpl,
        getSettings,
        urlValue: candidate.artifact.provenance.url,
        destination: provenancePath,
        expectedSha256: candidate.artifact.provenance.sha256,
        expectedSize: undefined,
        maxSize: PROVENANCE_SIZE_LIMIT,
      });
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
    const inspection = await inspectExecutable(executablePath, registration.descriptor, env);
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
    const authState = await runAuthProbe(executablePath, candidate.authProbe, env);
    const finalDir = runtimeStoreDir(storeDir, registration.descriptor.runtime, version, platform);
    const verification: ManagedRuntimeVerification = {
      sha256: downloaded.sha256,
      checksumVerified: true,
      signatureVerified,
      provenanceVerified,
      verifiedAt: now().toISOString(),
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
      installedAt: now().toISOString(),
      verification,
      authState,
    };
    await writeFile(
      path.join(payloadDir, INSTALLATION_FILE),
      `${JSON.stringify(record, null, 2)}\n`,
      { mode: 0o600 }
    );
    const installed = await runExclusive(async () => {
      await mkdir(path.dirname(finalDir), { recursive: true });
      if (existsSync(finalDir)) {
        throw new Error(`Managed runtime destination already exists without a valid record`);
      }
      await rename(payloadDir, finalDir);
      try {
        await updateReference(registration, version, pin);
      } catch (error) {
        await rm(finalDir, { force: true, recursive: true });
        throw error;
      }
      return await readInstallation(registration.descriptor.runtime, version, platform);
    });
    if (!installed) throw new Error('Managed runtime install record could not be reopened');
    return await resolvedManaged(env, registration, installed);
  } finally {
    await rm(stagingRoot, { force: true, recursive: true }).catch(() => {});
  }
}
