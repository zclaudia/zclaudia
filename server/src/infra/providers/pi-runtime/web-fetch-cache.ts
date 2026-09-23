/**
 * In-process cache for WebFetch bodies (post-extraction, pre-`prompt`), so
 * repeated fetches of the same page within a turn or across a few turns do
 * not hit the network again. Keyed on the requested URL + extraction
 * options; TTL 15 minutes; bounded by total bytes with oldest-first eviction.
 */

export interface WebFetchCacheEntry<T> {
  value: T;
  size: number;
  expiresAt: number;
}

export class WebFetchCache<T> {
  private readonly entries = new Map<string, WebFetchCacheEntry<T>>();
  private totalBytes = 0;

  constructor(
    private readonly options: { ttlMs: number; maxBytes: number },
    private readonly now: () => number = Date.now
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.delete(key);
      return undefined;
    }
    // Refresh recency so hot entries survive eviction.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, size: number): void {
    if (size > this.options.maxBytes) return;
    this.delete(key);
    this.entries.set(key, { value, size, expiresAt: this.now() + this.options.ttlMs });
    this.totalBytes += size;
    for (const [oldest] of this.entries) {
      if (this.totalBytes <= this.options.maxBytes) break;
      this.delete(oldest);
    }
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.totalBytes -= entry.size;
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.totalBytes;
  }
}

export const WEB_FETCH_CACHE_TTL_MS = 15 * 60 * 1000;
export const WEB_FETCH_CACHE_MAX_BYTES = 50 * 1024 * 1024;
