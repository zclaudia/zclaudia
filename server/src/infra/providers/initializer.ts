import type Database from 'better-sqlite3';
import { newId } from '../../utils/uuid.js';
import { systemTaskRegistry } from '../../application/services/system-task-registry.js';
import { resolveEnvCredential } from './env-credential.js';

let tempFileCleanupTimer: ReturnType<typeof setInterval> | null = null;

export function autoDetectProviders(db: Database.Database): void {
  const cred = resolveEnvCredential();
  const now = Date.now();

  const existing = db.prepare('SELECT id FROM llm_profiles LIMIT 1').get() as { id: string } | undefined;
  if (!existing) {
    // Seed the default profile, materializing the env credential when present.
    db.prepare(`
      INSERT INTO llm_profiles (id, name, provider_type, base_url, api_key, compat, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?)
    `).run(
      newId(),
      'ZClaudia Agent',
      cred?.providerType ?? 'anthropic',
      cred?.baseUrl ?? null,
      cred?.apiKey ?? null,
      now,
      now,
    );
    console.log('   Registered default ZClaudia agent runtime');
    return;
  }

  // Backfill: fill a keyless default profile from env (bootstrap convenience →
  // profile becomes the source of truth). Never overwrite an existing credential.
  if (!cred) return;
  const def = db.prepare(`
    SELECT id, api_key, oauth_credentials FROM llm_profiles
    WHERE is_default = 1 ORDER BY updated_at DESC LIMIT 1
  `).get() as { id: string; api_key: string | null; oauth_credentials: string | null } | undefined;
  if (!def) return;
  const keyless = (def.api_key == null || def.api_key.trim() === '') && def.oauth_credentials == null;
  if (!keyless) return;

  db.prepare(`
    UPDATE llm_profiles SET provider_type = ?, base_url = ?, api_key = ?, updated_at = ? WHERE id = ?
  `).run(cred.providerType, cred.baseUrl ?? null, cred.apiKey, now, def.id);
  console.log('   Backfilled default ZClaudia agent credential from environment');
}

export function startTempFileCleanup(): void {
  systemTaskRegistry.register({
    id: 'system:temp_file_cleanup',
    name: 'Temp File Cleanup',
    description: 'Placeholder cleanup task for transient runtime files',
    category: 'maintenance',
    intervalMs: 30 * 60 * 1000,
  });
  tempFileCleanupTimer = setInterval(() => {
    systemTaskRegistry.markRunStart('system:temp_file_cleanup');
    systemTaskRegistry.markRunComplete('system:temp_file_cleanup', 0);
  }, 30 * 60 * 1000);
  tempFileCleanupTimer.unref();
}

export function checkProviderVersions(): void {
  // No third-party coding-agent SDKs are checked in zclaudia.
}

export async function shutdownProviders(): Promise<void> {
  if (tempFileCleanupTimer) {
    clearInterval(tempFileCleanupTimer);
    tempFileCleanupTimer = null;
  }
}
