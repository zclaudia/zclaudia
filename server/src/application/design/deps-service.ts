import { promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { readBoundedFile } from '../../infra/fs/safe-file-write.js';
import { DesignError, DesignService, toDesignError } from './design-service.js';
import {
  collectCssResourceRefs,
  collectHtmlResourceRefs,
  kindForPath,
  type ResourceRef,
  type SkippedResource,
} from './resource-graph.js';

// Dependency-stat bounds (P2 §4.1). The entry is read to discover references;
// every other file is only stat'ed — the endpoint polls every 2s while a panel
// is visible, so no content hashing happens here.
export const DEPS_MAX_ENTRY_BYTES = 2 * 1024 * 1024;
export const DEPS_MAX_CSS_READ_BYTES = 10 * 1024 * 1024;
export const DEPS_MAX_RESOURCES = 200;
export const DEPS_MAX_CSS_DEPTH = 4;

export type DesignDependencyKind = 'css' | 'image' | 'font' | 'video' | 'other';

export interface DesignDependencyStat {
  /** Workspace-relative path. */
  path: string;
  kind: DesignDependencyKind;
  size: number | null;
  mtimeMs: number | null;
  missing: boolean;
}

export interface DesignDepsResult {
  entry: { path: string; size: number; mtimeMs: number };
  files: DesignDependencyStat[];
  skipped: { raw: string; reason: string }[];
}

export class DepsService {
  private readonly design: DesignService;

  constructor(db: Database.Database) {
    this.design = new DesignService(db);
  }

  /**
   * Stat every local resource reachable from an HTML entry (CSS imports
   * included, depth ≤ 4, at most 200 references). Per-file failures never
   * reject the call — they degrade to `missing` entries or `skipped` reasons;
   * only entry-level failures (workspace, path, size) surface as errors.
   */
  async stat(sessionId: unknown, entryPath: unknown): Promise<DesignDepsResult> {
    const file = await this.design.resolveFile(sessionId, entryPath);
    if (!/\.html?$/i.test(file.relative))
      throw new DesignError(400, 'UNSUPPORTED_FILE', 'Only HTML documents can be inspected');
    let entryRead: { bytes: Buffer; stat: Stats };
    try {
      entryRead = await readBoundedFile(file.absolute, DEPS_MAX_ENTRY_BYTES, 'HTML document');
    } catch (error) {
      throw toDesignError(error);
    }

    const skipped: SkippedResource[] = [];
    const seenSkipped = new Set<string>();
    const mergeSkipped = (entries: SkippedResource[]): void => {
      for (const skip of entries) {
        const key = `${skip.raw}\u0000${skip.reason}`;
        if (seenSkipped.has(key)) continue;
        seenSkipped.add(key);
        skipped.push(skip);
      }
    };

    const files: DesignDependencyStat[] = [];
    const visited = new Set<string>([file.relative]);
    const queued = new Set<string>();
    const queue: Array<{ ref: ResourceRef; depth: number }> = [];
    let discovered = 0;
    const enqueue = (ref: ResourceRef, depth: number): void => {
      if (visited.has(ref.path) || queued.has(ref.path)) return;
      if (discovered >= DEPS_MAX_RESOURCES) {
        mergeSkipped([{ raw: ref.path, reason: 'resource-limit' }]);
        return;
      }
      discovered += 1;
      queued.add(ref.path);
      queue.push({ ref, depth });
    };

    const html = collectHtmlResourceRefs(entryRead.bytes.toString('utf8'), file.relative);
    mergeSkipped(html.skipped);
    for (const ref of html.refs) enqueue(ref, 1);

    while (queue.length) {
      const next = queue.shift();
      if (!next) break;
      const { ref, depth } = next;
      queued.delete(ref.path);
      if (visited.has(ref.path)) continue;
      visited.add(ref.path);

      const stat = await this.statReference(file.root, ref.path);
      if ('skipped' in stat) {
        mergeSkipped([stat.skipped]);
        continue;
      }
      files.push(stat.file);

      // Only stylesheets expand further; unreadable or missing CSS simply
      // ends the branch (stat-only contract — the read exists to discover
      // nested references, its failure is never an error).
      if (ref.kind !== 'css' || stat.file.missing) continue;
      let css: Buffer | null;
      try {
        css = (
          await readBoundedFile(path.join(file.root, ref.path), DEPS_MAX_CSS_READ_BYTES, 'Stylesheet')
        ).bytes;
      } catch {
        css = null;
      }
      if (!css) continue;
      const nested = collectCssResourceRefs(css.toString('utf8'), ref.path);
      mergeSkipped(nested.skipped);
      for (const child of nested.refs) {
        if (depth + 1 > DEPS_MAX_CSS_DEPTH) {
          mergeSkipped([{ raw: child.path, reason: 'resource-limit' }]);
          continue;
        }
        enqueue(child, depth + 1);
      }
    }

    return {
      entry: { path: file.relative, size: entryRead.stat.size, mtimeMs: entryRead.stat.mtimeMs },
      files,
      skipped,
    };
  }

  /**
   * Stat one referenced path (symlinks followed). Missing or non-regular
   * targets are reported as `missing`; a symlink whose realpath escapes the
   * workspace root is reported as skipped instead of stat'ed. References into
   * private dot-components are skipped like everywhere else in the workspace
   * boundary.
   */
  private async statReference(
    root: string,
    refPath: string
  ): Promise<{ file: DesignDependencyStat } | { skipped: SkippedResource }> {
    if (refPath.split('/').some(part => part.startsWith('.'))) {
      return { skipped: { raw: refPath, reason: 'private-path' } };
    }
    const absolute = path.join(root, refPath);
    try {
      const info = await fs.stat(absolute);
      let real: string;
      try {
        real = await fs.realpath(absolute);
      } catch {
        return { file: this.missingStat(refPath) };
      }
      const relative = path.relative(root, real);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return { skipped: { raw: refPath, reason: 'outside-workspace' } };
      }
      if (!info.isFile()) return { file: this.missingStat(refPath) };
      return {
        file: {
          path: refPath,
          kind: kindForPath(refPath),
          size: info.size,
          mtimeMs: info.mtimeMs,
          missing: false,
        },
      };
    } catch {
      return { file: this.missingStat(refPath) };
    }
  }

  private missingStat(refPath: string): DesignDependencyStat {
    return { path: refPath, kind: kindForPath(refPath), size: null, mtimeMs: null, missing: true };
  }
}
