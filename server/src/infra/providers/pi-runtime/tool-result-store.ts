/**
 * Disk persistence for oversize tool results.
 *
 * When a turn's tool results exceed the context budget, the full text of the
 * largest results is written here and the in-context result is replaced with a
 * short preview plus the file path, which the model can Read back on demand.
 */
import { mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { resolveDataDir } from '../../../domains/tasks/executors/command-executor.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContentBlock = { type: string; text?: string; [k: string]: any };

export function toolResultsDir(): string {
  return path.join(resolveDataDir(), 'tool-results');
}

export function measureTextBytes(content: ContentBlock[]): number {
  let total = 0;
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      total += Buffer.byteLength(block.text, 'utf8');
    }
  }
  return total;
}

/**
 * Write the text blocks of a tool result to disk. Returns undefined when there
 * is no text to persist or the write fails (caller falls back to inline content).
 */
export function persistToolResultText(
  toolName: string,
  content: ContentBlock[],
): { filePath: string; size: number } | undefined {
  const text = content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n');
  if (!text) return undefined;
  try {
    const dir = toolResultsDir();
    mkdirSync(dir, { recursive: true });
    const safeTool = toolName.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'tool';
    const filePath = path.join(dir, `${Date.now()}-${safeTool}-${randomUUID().slice(0, 8)}.txt`);
    writeFileSync(filePath, text, 'utf8');
    return { filePath, size: Buffer.byteLength(text, 'utf8') };
  } catch {
    return undefined;
  }
}
