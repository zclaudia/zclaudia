import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SCHEMA_VERSION_FILE = 'schema-version.txt';
const CURRENT_SCHEMA_VERSION = 'compaction-bolt-on-2026-06-03';

/**
 * In dev mode (NODE_ENV=development OR ZCLAUDIA_DEV set): if the recorded
 * schema version differs from CURRENT, wipe the data directory. Forces a
 * clean slate when schema breaks backwards-compatibility.
 *
 * Caller invokes BEFORE opening the DB / migrations. Returns {wiped:true}
 * when wipe happened so caller can log / surface.
 *
 * No-op outside dev mode and when data dir doesn't exist.
 */
export function maybeWipeDevDataDir(dataDir: string): { wiped: boolean; reason?: string } {
  const isDev = process.env.NODE_ENV === 'development' || !!process.env.ZCLAUDIA_DEV;
  if (!isDev) return { wiped: false };
  if (!existsSync(dataDir)) return { wiped: false };

  const versionPath = path.join(dataDir, SCHEMA_VERSION_FILE);
  let recorded = '';
  try {
    if (existsSync(versionPath)) recorded = readFileSync(versionPath, 'utf-8').trim();
  } catch {
    recorded = '';
  }
  if (recorded === CURRENT_SCHEMA_VERSION) return { wiped: false };

  console.warn(`[dev-clear] schema version mismatch (recorded='${recorded}', current='${CURRENT_SCHEMA_VERSION}') — wiping ${dataDir}`);
  rmSync(dataDir, { recursive: true, force: true });
  return { wiped: true, reason: `version-mismatch: ${recorded} → ${CURRENT_SCHEMA_VERSION}` };
}

/** Write the current schema version marker. Call AFTER successful migration. */
export function writeSchemaVersion(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, SCHEMA_VERSION_FILE), CURRENT_SCHEMA_VERSION);
}
