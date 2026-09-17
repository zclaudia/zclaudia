import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { MANAGED_RUNTIME_PLATFORM_KEYS } from '@zclaudia/shared/plugins/managed-runtimes';
import { readJson } from './store.js';
import { runtimeStoreDir, VERSION_PATTERN, type RuntimeReference } from './types.js';

export async function collectReferencedInstallations(options: {
  refsDir: string;
  storeDir: string;
}): Promise<Set<string>> {
  const { refsDir, storeDir } = options;
  const referenced = new Set<string>();
  const pluginDirs = await readdir(refsDir, { withFileTypes: true }).catch(() => []);
  for (const pluginDir of pluginDirs.filter(entry => entry.isDirectory())) {
    const files = await readdir(path.join(refsDir, pluginDir.name), {
      withFileTypes: true,
    }).catch(() => []);
    for (const file of files.filter(entry => entry.isFile() && entry.name.endsWith('.json'))) {
      const ref = await readJson<RuntimeReference>(path.join(refsDir, pluginDir.name, file.name));
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
        referenced.add(runtimeStoreDir(storeDir, ref.runtime, version, ref.platform));
      }
    }
  }
  return referenced;
}

export async function collectGarbage(options: {
  refsDir: string;
  storeDir: string;
  now: () => Date;
  graceMs: number;
}): Promise<{ removed: string[] }> {
  const { refsDir, storeDir, now, graceMs } = options;
  const referenced = await collectReferencedInstallations({ refsDir, storeDir });
  const removed: string[] = [];
  const runtimeDirs = await readdir(storeDir, { withFileTypes: true }).catch(() => []);
  for (const runtimeDir of runtimeDirs.filter(entry => entry.isDirectory())) {
    const versionDirs = await readdir(path.join(storeDir, runtimeDir.name), {
      withFileTypes: true,
    }).catch(() => []);
    for (const versionDir of versionDirs.filter(entry => entry.isDirectory())) {
      const platformDirs = await readdir(
        path.join(storeDir, runtimeDir.name, versionDir.name),
        { withFileTypes: true }
      ).catch(() => []);
      for (const platformDir of platformDirs.filter(entry => entry.isDirectory())) {
        const candidate = path.resolve(storeDir, runtimeDir.name, versionDir.name, platformDir.name);
        if (referenced.has(candidate)) continue;
        const storeRoot = path.resolve(storeDir);
        if (!candidate.startsWith(`${storeRoot}${path.sep}`)) continue;
        const details = await stat(candidate).catch(() => undefined);
        if (!details || now().getTime() - details.mtimeMs < graceMs) continue;
        await rm(candidate, { recursive: true, force: true });
        removed.push(candidate);
      }
    }
  }
  return { removed };
}
