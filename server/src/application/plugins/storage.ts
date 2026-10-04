/**
 * Plugin Storage - Persistent key-value store for plugins.
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveDataDir, resolveLegacyDataDir, seedFromLegacyFile } from '../../utils/data-dir.js';

const MAX_STORAGE_BYTES = 5 * 1024 * 1024;
const STORAGE_DIR = 'plugin-storage';

/** `$ZCLAUDIA_DATA_DIR/plugin-storage` (default `~/.zclaudia/plugin-storage`). */
export function pluginStorageDir(): string {
  return path.join(resolveDataDir(), STORAGE_DIR);
}

/** Pre-rename location; only ever read, to seed a plugin's file in the data dir. */
export function legacyPluginStorageDir(): string {
  return path.join(resolveLegacyDataDir(), STORAGE_DIR);
}

function storageFileName(pluginId: string): string {
  return `${pluginId}.json`;
}

/**
 * Path of a plugin's storage file in the data dir, seeded once from the legacy
 * `~/.claudia/plugin-storage/<id>.json` when it does not exist yet.
 */
export function resolvePluginStorageFile(pluginId: string): string {
  const storagePath = path.join(pluginStorageDir(), storageFileName(pluginId));
  migrateLegacyStorageFile(
    pluginId,
    path.join(legacyPluginStorageDir(), storageFileName(pluginId)),
    storagePath
  );
  return storagePath;
}

function migrateLegacyStorageFile(pluginId: string, legacyPath: string, storagePath: string): void {
  try {
    seedFromLegacyFile(legacyPath, storagePath);
  } catch (error) {
    console.error(`[PluginStorage] Failed to migrate legacy storage for ${pluginId}:`, error);
  }
}

export interface PluginStorageOptions {
  /** Defaults to `<pluginStorageDir()>/<pluginId>.json`. */
  storagePath?: string;
  /**
   * File copied into `storagePath` on first load when that file does not exist
   * yet. Defaults to the plugin's file in {@link legacyPluginStorageDir} for
   * the default storage path, and to no migration when `storagePath` is given
   * explicitly.
   */
  legacyStoragePath?: string | null;
}

export interface StorageAPI {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

export class PluginStorage implements StorageAPI {
  private storagePath: string;
  private legacyStoragePath: string | null;
  private cache = new Map<string, unknown>();
  private loaded = false;

  constructor(
    private pluginId: string,
    options: PluginStorageOptions = {}
  ) {
    this.storagePath =
      options.storagePath ?? path.join(pluginStorageDir(), storageFileName(pluginId));
    this.legacyStoragePath =
      options.legacyStoragePath !== undefined
        ? options.legacyStoragePath
        : options.storagePath === undefined
          ? path.join(legacyPluginStorageDir(), storageFileName(pluginId))
          : null;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (this.legacyStoragePath) {
        migrateLegacyStorageFile(this.pluginId, this.legacyStoragePath, this.storagePath);
      }

      if (fs.existsSync(this.storagePath)) {
        const content = fs.readFileSync(this.storagePath, 'utf-8');
        const data = JSON.parse(content);
        if (data && typeof data === 'object') {
          this.cache = new Map(Object.entries(data));
        }
      }
      this.loaded = true;
    } catch (error) {
      console.error(`[PluginStorage] Failed to load storage for ${this.pluginId}:`, error);
      this.cache = new Map();
    }
  }

  private async persist(): Promise<void> {
    try {
      const data = Object.fromEntries(this.cache);
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error(`[PluginStorage] Failed to persist storage for ${this.pluginId}:`, error);
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    await this.ensureLoaded();
    return this.cache.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.ensureLoaded();
    this.cache.set(key, value);

    const data = JSON.stringify(Object.fromEntries(this.cache));
    if (Buffer.byteLength(data, 'utf-8') > MAX_STORAGE_BYTES) {
      this.cache.delete(key);
      throw new Error(
        `Storage limit exceeded for plugin ${this.pluginId} (max ${MAX_STORAGE_BYTES / 1024 / 1024}MB)`
      );
    }

    await this.persist();
  }

  async delete(key: string): Promise<void> {
    await this.ensureLoaded();
    this.cache.delete(key);
    await this.persist();
  }

  async clear(): Promise<void> {
    this.cache.clear();
    await this.persist();
  }

  async keys(): Promise<string[]> {
    await this.ensureLoaded();
    return Array.from(this.cache.keys());
  }

  getCache(): Map<string, unknown> {
    return new Map(this.cache);
  }
}

export class PluginStorageManager {
  private storages = new Map<string, PluginStorage>();

  getStorage(pluginId: string): StorageAPI {
    if (!this.storages.has(pluginId)) {
      this.storages.set(pluginId, new PluginStorage(pluginId));
    }
    return this.storages.get(pluginId)!;
  }

  clearStorage(pluginId: string): void {
    this.storages.delete(pluginId);
  }

  clearAll(): void {
    this.storages.clear();
  }
}

export const pluginStorageManager = new PluginStorageManager();
