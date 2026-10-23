import { createHash } from 'node:crypto';
import path from 'node:path';
import type Database from 'better-sqlite3';
import JSZip from 'jszip';
import { readBoundedFile } from '../../infra/fs/safe-file-write.js';
import { DesignError, DesignService, toDesignError } from './design-service.js';
import {
  collectCssResourceRefs,
  collectHtmlResourceRefs,
  type ResourceRef,
  type SkippedResource,
} from './resource-graph.js';

// Export bounds (P2 §6.1) — same scale as the P1 snapshot capture.
export const EXPORT_MAX_ENTRY_BYTES = 2 * 1024 * 1024;
export const EXPORT_MAX_RESOURCE_BYTES = 10 * 1024 * 1024;
export const EXPORT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const EXPORT_MAX_RESOURCES = 200;
export const EXPORT_MAX_CSS_DEPTH = 4;
export const EXPORT_MANIFEST_NAME = 'zclaudia-export.json';

export type DesignExportFileKind = 'entry' | 'css' | 'image' | 'font' | 'other';

export interface DesignExportManifestFile {
  path: string;
  sha256: string;
  bytes: number;
  kind: DesignExportFileKind;
}

export interface DesignExportManifestShape {
  version: 1;
  mode: 'disk' | 'draft';
  entryPath: string;
  exportedAt: number;
  files: DesignExportManifestFile[];
  missing: string[];
  skipped: { raw: string; reason: string }[];
}

export interface ExportInvocation {
  sessionId: unknown;
  path: unknown;
  mode: 'disk' | 'draft';
  expectedRevision?: unknown;
  draftSource?: unknown;
  confirmIncomplete?: unknown;
}

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  manifest: DesignExportManifestShape;
}

interface PackagedFile {
  bytes: Buffer;
  kind: DesignExportFileKind;
}

function sha256(source: Buffer | string): string {
  return createHash('sha256').update(source).digest('hex');
}

/**
 * `<sanitized entry basename>-<YYYYMMDD-HHmmss>.zip` in server-local time.
 * Every character outside [A-Za-z0-9._-] becomes `_` so the name is safe in
 * a Content-Disposition header and on every target filesystem.
 */
export function buildExportFilename(entryPath: string, now = new Date()): string {
  const base = path.posix.basename(entryPath).replace(/\.[^.]+$/, '');
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_') || 'export';
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${safe}-${stamp}.zip`;
}

export class ExportService {
  private readonly design: DesignService;

  constructor(db: Database.Database) {
    this.design = new DesignService(db);
  }

  /**
   * Package an entry plus its local resource graph into a self-contained ZIP
   * (P2 §6.1). Missing resources reject with EXPORT_INCOMPLETE (409) unless
   * `confirmIncomplete` is set; size/reference limits reject with
   * EXPORT_LIMIT_EXCEEDED (413).
   */
  async exportZip(inv: ExportInvocation): Promise<ExportResult> {
    if (inv.mode !== 'disk' && inv.mode !== 'draft')
      throw new DesignError(400, 'VALIDATION_ERROR', 'mode must be "disk" or "draft"');
    const file = await this.design.resolveFile(inv.sessionId, inv.path);
    if (!/\.html?$/i.test(file.relative))
      throw new DesignError(400, 'UNSUPPORTED_FILE', 'Only HTML entry documents can be exported');

    let entryBytes: Buffer;
    if (inv.mode === 'disk') {
      entryBytes = await this.readEntryForDisk(inv.expectedRevision, file.absolute);
    } else {
      if (typeof inv.draftSource !== 'string')
        throw new DesignError(400, 'VALIDATION_ERROR', 'draftSource is required for draft exports');
      const bytes = Buffer.from(inv.draftSource, 'utf8');
      if (bytes.length > EXPORT_MAX_ENTRY_BYTES)
        throw new DesignError(413, 'EXPORT_LIMIT_EXCEEDED', 'Draft source exceeds the 2 MiB limit');
      entryBytes = bytes;
    }

    const { files, missing, skipped } = await this.collectResources(
      file.root,
      file.relative,
      entryBytes
    );

    if (missing.length > 0 && inv.confirmIncomplete !== true)
      throw new DesignError(409, 'EXPORT_INCOMPLETE', 'Referenced resources are missing', {
        files: missing,
      });

    return this.package(file.relative, inv.mode, entryBytes, files, missing, skipped);
  }

  /** Step 2, disk mode: bounded entry read pinned to the client's revision. */
  private async readEntryForDisk(expectedRevision: unknown, absolute: string): Promise<Buffer> {
    let read: { bytes: Buffer };
    try {
      read = await readBoundedFile(absolute, EXPORT_MAX_ENTRY_BYTES, 'HTML document');
    } catch (error) {
      throw toDesignError(error);
    }
    if (expectedRevision !== undefined) {
      if (typeof expectedRevision !== 'string')
        throw new DesignError(400, 'VALIDATION_ERROR', 'expectedRevision must be a string');
      if (expectedRevision !== sha256(read.bytes))
        throw new DesignError(409, 'REVISION_CONFLICT', 'Entry changed since it was loaded');
    }
    return read.bytes;
  }

  /**
   * Steps 3–4: BFS the resource graph with hard limits (count, depth, per-file
   * and total size). Absent resources land in `missing` while the manifest
   * keeps collecting; unreadable-but-present non-regular targets are treated
   * the same way — they cannot be packaged either. Security boundaries
   * (symlink/escape PATH_FORBIDDEN) still abort the export.
   */
  private async collectResources(
    root: string,
    entryPath: string,
    entryBytes: Buffer
  ): Promise<{
    files: Map<string, PackagedFile>;
    missing: string[];
    skipped: SkippedResource[];
  }> {
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

    const files = new Map<string, PackagedFile>();
    const missing: string[] = [];
    let totalBytes = entryBytes.length;
    const visited = new Set<string>([entryPath]);
    const queued = new Set<string>();
    const queue: Array<{ ref: ResourceRef; depth: number }> = [];
    let discovered = 0;
    const enqueue = (ref: ResourceRef, depth: number): void => {
      if (visited.has(ref.path) || queued.has(ref.path)) return;
      if (discovered >= EXPORT_MAX_RESOURCES)
        throw new DesignError(
          413,
          'EXPORT_LIMIT_EXCEEDED',
          `Export exceeds the ${EXPORT_MAX_RESOURCES} reference limit`
        );
      discovered += 1;
      queued.add(ref.path);
      queue.push({ ref, depth });
    };

    const html = collectHtmlResourceRefs(entryBytes.toString('utf8'), entryPath);
    mergeSkipped(html.skipped);
    for (const ref of html.refs) enqueue(ref, 1);

    while (queue.length) {
      const next = queue.shift();
      if (!next) break;
      const { ref, depth } = next;
      queued.delete(ref.path);
      if (visited.has(ref.path)) continue;
      visited.add(ref.path);

      let resolved: { absolute: string };
      try {
        resolved = await this.design.resolve(root, ref.path);
      } catch (error) {
        if (error instanceof DesignError && error.status === 404) {
          missing.push(ref.path);
          continue;
        }
        throw error;
      }
      let bytes: Buffer;
      try {
        bytes = (await readBoundedFile(resolved.absolute, EXPORT_MAX_RESOURCE_BYTES, 'Resource'))
          .bytes;
      } catch (error) {
        const mapped = toDesignError(error);
        if (mapped instanceof DesignError && mapped.code === 'FILE_NOT_FOUND') {
          missing.push(ref.path);
          continue;
        }
        if (mapped instanceof DesignError && mapped.code === 'FILE_TOO_LARGE')
          throw new DesignError(
            413,
            'EXPORT_LIMIT_EXCEEDED',
            `Resource exceeds the per-file size limit: ${ref.path}`
          );
        if (mapped instanceof DesignError && mapped.code === 'UNSUPPORTED_FILE') {
          // Exists but cannot be packaged (e.g. a directory) — handled like
          // any other unpackageable reference so the manifest stays complete.
          missing.push(ref.path);
          continue;
        }
        throw mapped;
      }
      if (totalBytes + bytes.length > EXPORT_MAX_TOTAL_BYTES)
        throw new DesignError(
          413,
          'EXPORT_LIMIT_EXCEEDED',
          'Export exceeds the total size limit'
        );
      totalBytes += bytes.length;
      files.set(ref.path, { bytes, kind: ref.kind });

      if (ref.kind !== 'css') continue;
      const nested = collectCssResourceRefs(bytes.toString('utf8'), ref.path);
      mergeSkipped(nested.skipped);
      for (const child of nested.refs) {
        if (depth + 1 > EXPORT_MAX_CSS_DEPTH)
          throw new DesignError(
            413,
            'EXPORT_LIMIT_EXCEEDED',
            `Export exceeds the CSS import depth limit at ${child.path}`
          );
        enqueue(child, depth + 1);
      }
    }
    return { files, missing, skipped };
  }

  /** Steps 6–8: zip at workspace-relative paths plus the root manifest. */
  private async package(
    entryPath: string,
    mode: 'disk' | 'draft',
    entryBytes: Buffer,
    files: Map<string, PackagedFile>,
    missing: string[],
    skipped: SkippedResource[]
  ): Promise<ExportResult> {
    const zip = new JSZip();
    const manifestFiles: DesignExportManifestFile[] = [];
    const add = (relPath: string, bytes: Buffer, kind: DesignExportFileKind): void => {
      zip.file(relPath, bytes);
      manifestFiles.push({ path: relPath, sha256: sha256(bytes), bytes: bytes.length, kind });
    };
    add(entryPath, entryBytes, 'entry');
    for (const [relPath, packaged] of files) add(relPath, packaged.bytes, packaged.kind);

    const manifest: DesignExportManifestShape = {
      version: 1,
      mode,
      entryPath,
      exportedAt: Date.now(),
      files: manifestFiles,
      missing,
      skipped,
    };
    zip.file(EXPORT_MANIFEST_NAME, JSON.stringify(manifest, null, 2));

    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    return { buffer, filename: buildExportFilename(entryPath), manifest };
  }
}
