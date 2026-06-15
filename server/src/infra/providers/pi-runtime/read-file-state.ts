import { stat } from 'fs/promises';
import path from 'path';

export interface ReadFileStateEntry {
  content: string;
  timestamp: number;
  offset?: number;
  limit?: number;
  isPartialView: boolean;
}

export interface ReadFileStateStore {
  get(filePath: string): ReadFileStateEntry | undefined;
  recordRead(filePath: string, input: {
    content: string;
    offset: number;
    limit: number;
    totalLines: number;
    returnedLines: number;
    isPartialView?: boolean;
    timestamp?: number;
  }): Promise<void>;
  recordWrite(filePath: string, content: string): Promise<void>;
  assertFullRead(filePath: string): { ok: true } | { ok: false; code: 'file_not_read' | 'partial_read'; message: string };
  assertSafeToWrite(filePath: string, currentContent: string): Promise<
    { ok: true } | { ok: false; code: 'file_not_read' | 'partial_read' | 'file_modified_since_read'; message: string }
  >;
}

function normalizeStateKey(filePath: string): string {
  return path.resolve(filePath);
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

export function createReadFileStateStore(): ReadFileStateStore {
  const entries = new Map<string, ReadFileStateEntry>();

  return {
    get(filePath) {
      return entries.get(normalizeStateKey(filePath));
    },

    async recordRead(filePath, input) {
      const timestamp = input.timestamp ?? (await stat(filePath)).mtimeMs;
      const fullRange = input.offset === 1 && input.returnedLines >= input.totalLines;
      entries.set(normalizeStateKey(filePath), {
        content: normalizeContent(input.content),
        timestamp,
        offset: input.offset,
        limit: input.limit,
        isPartialView: input.isPartialView ?? !fullRange,
      });
    },

    async recordWrite(filePath, content) {
      const fileStat = await stat(filePath);
      entries.set(normalizeStateKey(filePath), {
        content: normalizeContent(content),
        timestamp: fileStat.mtimeMs,
        isPartialView: false,
      });
    },

    assertFullRead(filePath) {
      const entry = entries.get(normalizeStateKey(filePath));
      if (!entry) {
        return {
          ok: false,
          code: 'file_not_read',
          message: 'File has not been read yet. Read it before editing or overwriting it.',
        };
      }
      if (entry.isPartialView) {
        return {
          ok: false,
          code: 'partial_read',
          message: 'File was only partially read. Read the full file before editing or overwriting it.',
        };
      }
      return { ok: true };
    },

    async assertSafeToWrite(filePath, currentContent) {
      const readCheck = this.assertFullRead(filePath);
      if (!readCheck.ok) return readCheck;

      const entry = entries.get(normalizeStateKey(filePath));
      if (!entry) return readCheck;

      if (normalizeContent(currentContent) === entry.content) return { ok: true };

      await stat(filePath);

      return {
        ok: false,
        code: 'file_modified_since_read',
        message: 'File has been modified since it was read. Read it again before editing or overwriting it.',
      };
    },
  };
}
