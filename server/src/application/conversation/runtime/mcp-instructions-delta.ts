import type Database from 'better-sqlite3';
import {
  computeMcpInstructionsDelta,
  MCP_INSTRUCTIONS_DELTA_METADATA_TYPE,
  type McpInstructionsDelta,
} from '@zclaudia/shared/core/mcp';
import { newId } from '../../../utils/uuid.js';
import { mcpClientManager } from '../../../utils/mcp-client-manager.js';

function readPreviousDeltas(db: Database.Database, sessionId: string): McpInstructionsDelta[] {
  const rows = db.prepare<[string], { metadata: string | null }>(`
    SELECT metadata FROM messages
    WHERE session_id = ? AND metadata IS NOT NULL
    ORDER BY created_at ASC
  `).all(sessionId);
  const deltas: McpInstructionsDelta[] = [];
  for (const row of rows) {
    try {
      const metadata = row.metadata ? JSON.parse(row.metadata) : undefined;
      if (metadata?.type === MCP_INSTRUCTIONS_DELTA_METADATA_TYPE && metadata.delta) {
        deltas.push(metadata.delta as McpInstructionsDelta);
      }
    } catch {
      // Ignore malformed metadata; history rebuilders follow the same lenient pattern.
    }
  }
  return deltas;
}

function nextOffset(db: Database.Database, sessionId: string): number {
  const row = db.prepare<[string], { nextOffset: number }>(`
    SELECT COALESCE(MAX(offset), 0) + 1 AS nextOffset
    FROM messages
    WHERE session_id = ?
  `).get(sessionId);
  return row?.nextOffset ?? 1;
}

export function persistMcpInstructionsDeltaForSession(
  db: Database.Database,
  sessionId: string,
): McpInstructionsDelta | null {
  if (!db || typeof (db as { prepare?: unknown }).prepare !== 'function') return null;
  const connectedInstructions = mcpClientManager.listStatuses()
    .filter((status) => status.state === 'connected' && status.instructions?.trim())
    .map((status) => ({ name: status.name, instructions: status.instructions }));
  const delta = computeMcpInstructionsDelta(
    connectedInstructions,
    readPreviousDeltas(db, sessionId),
    Date.now(),
  );
  if (!delta) return null;

  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, metadata, created_at, offset)
    VALUES (?, ?, 'system', ?, ?, ?, ?)
  `).run(
    newId(),
    sessionId,
    `MCP server instructions updated: +${delta.addedNames.join(', ') || 'none'} -${delta.removedNames.join(', ') || 'none'}`,
    JSON.stringify({ type: MCP_INSTRUCTIONS_DELTA_METADATA_TYPE, delta }),
    delta.createdAt,
    nextOffset(db, sessionId),
  );
  return delta;
}
