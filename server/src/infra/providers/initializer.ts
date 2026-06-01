import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { systemTaskRegistry } from '../../application/services/system-task-registry.js';

let tempFileCleanupTimer: ReturnType<typeof setInterval> | null = null;

export function autoDetectProviders(db: Database.Database): void {
  const existing = db.prepare('SELECT id FROM llm_profiles LIMIT 1').get() as { id: string } | undefined;
  if (existing) return;

  const now = Date.now();
  db.prepare(`
    INSERT INTO llm_profiles (id, name, provider_type, base_url, api_key, compat, env, is_default, created_at, updated_at)
    VALUES (?, ?, 'anthropic', NULL, NULL, NULL, NULL, 1, ?, ?)
  `).run(randomUUID(), 'ZClaudia Agent', now, now);

  console.log('   Registered default ZClaudia agent runtime');
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
