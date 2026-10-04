/**
 * DocumentStore — what the server has been told about each file.
 *
 * Every consumer syncs from disk before asking anything, because many changes
 * never pass the write lifecycle (Bash `sed`, codegen, `git checkout`). A
 * content hash keeps unchanged files from producing didChange noise.
 */
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

export interface DocumentSink {
  notify(method: string, params: unknown): Promise<void>;
  /** Send didSave after open/change (servers that analyse on save). */
  readonly wantsSave: boolean;
}

export type SyncOutcome = 'opened' | 'changed' | 'unchanged' | 'missing';

interface OpenDocument {
  uri: string;
  version: number;
  hash: string;
}

const DEFAULT_MAX_OPEN = 200;

export function fileUri(file: string): string {
  return pathToFileURL(path.resolve(file)).href;
}

function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

export class DocumentStore {
  // Insertion order doubles as LRU order (touch = delete + set).
  private readonly open = new Map<string, OpenDocument>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly sink: DocumentSink,
    private readonly languageIdFor: (file: string) => string,
    private readonly maxOpen = DEFAULT_MAX_OPEN
  ) {}

  get size(): number {
    return this.open.size;
  }

  isOpen(file: string): boolean {
    return this.open.has(path.resolve(file));
  }

  /** Make the server's copy of `file` equal `text`. */
  syncText(file: string, text: string): Promise<SyncOutcome> {
    return this.serialize(path.resolve(file), key => this.apply(key, text));
  }

  /** Make the server's copy equal the file on disk; a deleted file is closed. */
  syncFromDisk(file: string): Promise<SyncOutcome> {
    return this.serialize(path.resolve(file), async key => {
      let text: string;
      try {
        text = await readFile(key, 'utf8');
      } catch {
        await this.close(key);
        return 'missing';
      }
      return this.apply(key, text);
    });
  }

  async closeAll(): Promise<void> {
    const keys = [...this.open.keys()];
    await Promise.all(keys.map(key => this.close(key).catch(() => undefined)));
  }

  // Per-file serialization: versions must reach the server in order.
  private serialize<T>(key: string, task: (key: string) => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(
      () => task(key),
      () => task(key)
    );
    this.queues.set(key, next);
    void next.finally(() => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    });
    return next;
  }

  private async apply(key: string, text: string): Promise<SyncOutcome> {
    const hash = hashText(text);
    const existing = this.open.get(key);
    if (existing) {
      this.open.delete(key);
      this.open.set(key, existing);
      if (existing.hash === hash) return 'unchanged';
      existing.version += 1;
      existing.hash = hash;
      await this.sink.notify('textDocument/didChange', {
        textDocument: { uri: existing.uri, version: existing.version },
        contentChanges: [{ text }],
      });
      await this.maybeSave(existing.uri, text);
      return 'changed';
    }
    const document: OpenDocument = { uri: fileUri(key), version: 1, hash };
    this.open.set(key, document);
    await this.sink.notify('textDocument/didOpen', {
      textDocument: {
        uri: document.uri,
        languageId: this.languageIdFor(key),
        version: document.version,
        text,
      },
    });
    await this.maybeSave(document.uri, text);
    await this.evictOverflow();
    return 'opened';
  }

  private async maybeSave(uri: string, text: string): Promise<void> {
    if (!this.sink.wantsSave) return;
    await this.sink.notify('textDocument/didSave', { textDocument: { uri }, text });
  }

  private async evictOverflow(): Promise<void> {
    while (this.open.size > this.maxOpen) {
      const oldest = this.open.keys().next().value;
      if (oldest === undefined) return;
      await this.close(oldest);
    }
  }

  private async close(key: string): Promise<void> {
    const document = this.open.get(key);
    if (!document) return;
    this.open.delete(key);
    await this.sink.notify('textDocument/didClose', { textDocument: { uri: document.uri } });
  }
}
