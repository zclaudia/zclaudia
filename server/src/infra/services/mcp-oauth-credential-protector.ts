import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { McpOAuthCredentials } from '@zclaudia/shared/core/mcp';
import { normalizeMcpOAuthCredentials } from '@zclaudia/shared/core/mcp';

const PREFIX = 'zclaudia:v1:';
const KEY_ENV = 'ZCLAUDIA_MCP_CREDENTIAL_KEY';

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Buffer {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function keyMaterial(): string {
  if (process.env[KEY_ENV]) return process.env[KEY_ENV]!;
  const dir = join(homedir(), '.zclaudia');
  const file = join(dir, 'mcp-credential-key');
  try {
    if (!existsSync(file)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(file, base64Url(randomBytes(32)), { mode: 0o600 });
    }
    return readFileSync(file, 'utf8').trim();
  } catch {
    // Last-resort fallback keeps the app usable in read-only environments while
    // still avoiding plaintext tokens in the database.
    return `${hostname()}:${homedir()}`;
  }
}

function encryptionKey(): Buffer {
  return createHash('sha256').update(keyMaterial()).digest();
}

export function protectMcpOAuthCredentials(value: unknown): string | null {
  const normalized = normalizeMcpOAuthCredentials(value);
  if (!normalized) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(normalized), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${base64Url(
    Buffer.from(
      JSON.stringify({
        iv: base64Url(iv),
        tag: base64Url(tag),
        data: base64Url(ciphertext),
      }),
      'utf8'
    )
  )}`;
}

export function unprotectMcpOAuthCredentials(
  raw: string | null | undefined
): McpOAuthCredentials | undefined {
  if (!raw) return undefined;
  if (!raw.startsWith(PREFIX)) {
    try {
      return normalizeMcpOAuthCredentials(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }
  try {
    const envelope = JSON.parse(fromBase64Url(raw.slice(PREFIX.length)).toString('utf8')) as {
      iv?: unknown;
      tag?: unknown;
      data?: unknown;
    };
    if (
      typeof envelope.iv !== 'string' ||
      typeof envelope.tag !== 'string' ||
      typeof envelope.data !== 'string'
    ) {
      return undefined;
    }
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), fromBase64Url(envelope.iv));
    decipher.setAuthTag(fromBase64Url(envelope.tag));
    const plaintext = Buffer.concat([
      decipher.update(fromBase64Url(envelope.data)),
      decipher.final(),
    ]).toString('utf8');
    return normalizeMcpOAuthCredentials(JSON.parse(plaintext));
  } catch {
    return undefined;
  }
}

export function backfillProtectedMcpOAuthCredentials(db: Database.Database): number {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mcp_servers'")
    .get();
  if (!table) return 0;
  const columns = db.prepare('PRAGMA table_info(mcp_servers)').all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === 'oauth_credentials')) return 0;

  const rows = db
    .prepare(
      `
    SELECT id, oauth_credentials
    FROM mcp_servers
    WHERE oauth_credentials IS NOT NULL AND oauth_credentials != ''
  `
    )
    .all() as Array<{ id: string; oauth_credentials: string }>;
  const update = db.prepare('UPDATE mcp_servers SET oauth_credentials = ? WHERE id = ?');
  let changed = 0;

  const run = db.transaction(() => {
    for (const row of rows) {
      if (row.oauth_credentials.startsWith(PREFIX)) continue;
      const protectedValue = protectMcpOAuthCredentials(
        unprotectMcpOAuthCredentials(row.oauth_credentials)
      );
      if (!protectedValue) continue;
      update.run(protectedValue, row.id);
      changed += 1;
    }
  });
  run();

  return changed;
}
