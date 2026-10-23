export interface EditHistoryEntry {
  /** Source the document was in before the edit. */
  before: string;
  /** Source the document was in after the edit. */
  after: string;
  label: string;
  /** Timestamp (epoch ms) the edit happened at. */
  at: number;
}

export interface EditHistoryOptions {
  /** Maximum number of entries; the oldest are evicted beyond it. Default 100. */
  limit?: number;
  /** Maximum cumulative bytes (before+after lengths); oldest evicted beyond it. Default 32 MiB. */
  maxBytes?: number;
  /** Window in which consecutive entries with the same mergeKey collapse. Default 1500 ms. */
  mergeWindowMs?: number;
}

interface InternalEntry extends EditHistoryEntry {
  mergeKey?: string;
}

const DEFAULT_LIMIT = 100;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_MERGE_WINDOW_MS = 1500;

/**
 * Snapshot-based bounded undo/redo history for design drafts.
 *
 * Entries store the full before/after strings; undo/redo is defensive: when
 * the caller's current draft does not match what the history expects, the
 * history treats it as an external change, rebuilds its baseline from the
 * current draft and returns null.
 */
export class EditHistory {
  private undoStack: InternalEntry[] = [];
  private redoStack: InternalEntry[] = [];
  private saved: string | null = null;
  private readonly limit: number;
  private readonly maxBytes: number;
  private readonly mergeWindowMs: number;

  constructor(options: EditHistoryOptions = {}) {
    this.limit = options.limit ?? DEFAULT_LIMIT;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.mergeWindowMs = options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS;
  }

  /**
   * Record an edit. When `mergeKey` equals the top entry's mergeKey and the
   * entry timestamps are within the merge window, only the top entry's `after`
   * is replaced (its before/label/at are kept). Otherwise the entry is pushed;
   * recording always clears the redo stack. Beyond `limit` or `maxBytes` the
   * oldest entries are evicted.
   */
  record(entry: EditHistoryEntry & { mergeKey?: string }): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (
      entry.mergeKey !== undefined &&
      top &&
      top.mergeKey === entry.mergeKey &&
      entry.at - top.at < this.mergeWindowMs
    ) {
      top.after = entry.after;
    } else {
      this.undoStack.push({
        before: entry.before,
        after: entry.after,
        label: entry.label,
        at: entry.at,
        mergeKey: entry.mergeKey,
      });
    }
    this.redoStack = [];
    this.evict();
  }

  /**
   * Undo: returns the state before the top entry, or null when there is
   * nothing to undo. If `current` does not match the top entry's `after`, the
   * draft changed externally: the history rebuilds its baseline and returns
   * null.
   */
  undo(current: string): string | null {
    const top = this.undoStack[this.undoStack.length - 1];
    if (!top) return null;
    if (current !== top.after) {
      this.rebuild(current);
      return null;
    }
    this.undoStack.pop();
    this.redoStack.push(top);
    return top.before;
  }

  /**
   * Redo: returns the state after the most recently undone entry, or null.
   * Symmetric defense to undo: a mismatching `current` rebuilds the history.
   */
  redo(current: string): string | null {
    const top = this.redoStack[this.redoStack.length - 1];
    if (!top) return null;
    if (current !== top.before) {
      this.rebuild(current);
      return null;
    }
    this.redoStack.pop();
    this.undoStack.push(top);
    this.evict();
    return top.after;
  }

  /** Record the saved baseline. Keeps the history: the draft stays undoable after saving. */
  markSaved(source: string): void {
    this.saved = source;
  }

  /** Rebuild the baseline after an external takeover / reload / restore; clears all history. */
  rebuild(source: string): void {
    this.undoStack = [];
    this.redoStack = [];
    this.saved = source;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Last saved source for dirty checks (draft !== savedSource), or null when never saved. */
  get savedSource(): string | null {
    return this.saved;
  }

  private evict(): void {
    let bytes = this.undoStack.reduce((sum, entry) => sum + entry.before.length + entry.after.length, 0);
    while (
      this.undoStack.length > 0 &&
      (this.undoStack.length > this.limit || bytes > this.maxBytes)
    ) {
      const removed = this.undoStack.shift();
      if (!removed) break;
      bytes -= removed.before.length + removed.after.length;
    }
  }
}
