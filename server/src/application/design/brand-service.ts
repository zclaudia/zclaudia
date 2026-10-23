import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SafeFileWriteError,
  createRollingBackupKeeper,
  readBoundedFile,
  safeWriteFile,
} from '../../infra/fs/safe-file-write.js';
import {
  DesignError,
  DesignService,
  assertContained,
  toDesignError,
  validateRelativePath,
} from './design-service.js';

/** Each brand file is capped at 256 KiB (§3.3). */
export const MAX_BRAND_FILE_BYTES = 256 * 1024;

const DESIGN_MD_PATH = 'design/DESIGN.md';
const TOKENS_CSS_PATH = 'design/tokens.css';

export interface DesignBrandContent {
  designMd: string | null;
  tokensCss: string | null;
  designMdRevision: string | null;
  tokensCssRevision: string | null;
}

export interface BrandWriteInput {
  designMd?: unknown;
  designMdRevision?: unknown;
  tokensCss?: unknown;
  tokensCssRevision?: unknown;
}

// Pre-write backups live beside the document backups, outside any workspace.
// Resolution mirrors design-service.ts (ZCLAUDIA_DATA_DIR ?? ~/.zclaudia) and
// deliberately builds its own keeper instance instead of importing the
// document one, so the two services never evict each other's copies.
const BRAND_BACKUP_ROOT = path.join(
  process.env.ZCLAUDIA_DATA_DIR ? path.resolve(process.env.ZCLAUDIA_DATA_DIR) : path.join(os.homedir(), '.zclaudia'),
  'design-write-backups'
);
const brandBackupKeeper = createRollingBackupKeeper(BRAND_BACKUP_ROOT, 5);

function sha256(source: Buffer | string): string {
  return createHash('sha256').update(source).digest('hex');
}

/**
 * Read/write the brand file pair `design/DESIGN.md` + `design/tokens.css`
 * (P4.2 §3.3). The two files are written independently — a failure on the
 * second one leaves the first on disk (no cross-file atomicity, same
 * contract as multi-file saves), and the error message names the file.
 */
export class BrandService {
  constructor(private readonly design: DesignService) {}

  async read(sessionId: unknown): Promise<DesignBrandContent> {
    const root = await this.design.workspace(sessionId);
    const designMd = await this.readOne(root, DESIGN_MD_PATH);
    const tokensCss = await this.readOne(root, TOKENS_CSS_PATH);
    return {
      designMd: designMd?.content ?? null,
      designMdRevision: designMd?.revision ?? null,
      tokensCss: tokensCss?.content ?? null,
      tokensCssRevision: tokensCss?.revision ?? null,
    };
  }

  async write(
    sessionId: unknown,
    input: BrandWriteInput
  ): Promise<{ designMdRevision: string | null; tokensCssRevision: string | null }> {
    const root = await this.design.workspace(sessionId);
    const jobs = [
      { key: 'designMdRevision' as const, path: DESIGN_MD_PATH, content: input.designMd, revision: input.designMdRevision },
      { key: 'tokensCssRevision' as const, path: TOKENS_CSS_PATH, content: input.tokensCss, revision: input.tokensCssRevision },
    ].filter(job => job.content !== undefined);
    if (jobs.length === 0)
      throw new DesignError(400, 'VALIDATION_ERROR', 'designMd or tokensCss is required');

    const result: { designMdRevision: string | null; tokensCssRevision: string | null } = {
      designMdRevision: null,
      tokensCssRevision: null,
    };
    for (const job of jobs) {
      try {
        result[job.key] = await this.writeOne(root, job.path, job.content, job.revision);
      } catch (error) {
        throw BrandService.annotate(error, job.path);
      }
    }
    return result;
  }

  /**
   * Containment-checked absolute path for a fixed brand constant. The parent
   * directory is realpath'd so a symlinked `design/` component cannot carry
   * the write outside the workspace (the leaf itself is guarded by
   * safeWriteFile's O_NOFOLLOW + final-check rename).
   */
  private async containedAbsolute(root: string, relativePath: string, createDir?: boolean): Promise<string> {
    const relative = validateRelativePath(relativePath);
    const absolute = path.resolve(root, relative);
    assertContained(root, absolute);
    const parent = path.dirname(absolute);
    if (createDir) await fs.mkdir(parent, { recursive: true });
    try {
      assertContained(root, await fs.realpath(parent));
    } catch (error) {
      // Missing parent on the read path: readBoundedFile reports FILE_NOT_FOUND.
      // Any other failure (including a containment violation) propagates.
      if (!(error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'))
        throw error;
    }
    return absolute;
  }

  private async readOne(
    root: string,
    relativePath: string
  ): Promise<{ content: string; revision: string } | null> {
    const absolute = await this.containedAbsolute(root, relativePath);
    try {
      const { bytes } = await readBoundedFile(absolute, MAX_BRAND_FILE_BYTES, 'Brand file');
      return { content: bytes.toString('utf8'), revision: sha256(bytes) };
    } catch (error) {
      if (error instanceof SafeFileWriteError && error.code === 'FILE_NOT_FOUND') return null;
      throw toDesignError(error);
    }
  }

  private async writeOne(
    root: string,
    relativePath: string,
    content: unknown,
    revision: unknown
  ): Promise<string> {
    if (typeof content !== 'string')
      throw new DesignError(400, 'VALIDATION_ERROR', 'content must be a string');
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length > MAX_BRAND_FILE_BYTES)
      throw new DesignError(413, 'FILE_TOO_LARGE', 'Brand file exceeds the 256 KiB limit');
    // Same revision rules as writeDocument: a SHA-256 verifies the current
    // on-disk content, an empty revision creates the file.
    const revisionIsHash = typeof revision === 'string' && /^[a-f0-9]{64}$/.test(revision);
    const revisionForCreate = revision === '' || revision === undefined;
    if (!revisionIsHash && !revisionForCreate)
      throw new DesignError(400, 'VALIDATION_ERROR', 'revision must be a SHA-256 revision');
    const absolute = await this.containedAbsolute(root, relativePath, true);
    try {
      await safeWriteFile(absolute, bytes, {
        maxBytes: MAX_BRAND_FILE_BYTES,
        expectedRevision: revisionIsHash ? (revision as string) : '',
        createIfMissing: revisionForCreate,
        backup: async (current, stat) => {
          // Backups are best-effort, mirroring writeDocument.
          try {
            await brandBackupKeeper(current, stat, absolute);
          } catch {
            /* ignore backup failures */
          }
        },
      });
    } catch (error) {
      throw toDesignError(error);
    }
    return sha256(bytes);
  }

  /** Name the failing file so a partial two-file write is diagnosable. */
  private static annotate(error: unknown, filePath: string): unknown {
    if (error instanceof DesignError)
      return new DesignError(error.status, error.code, `${filePath}: ${error.message}`, error.details);
    return error;
  }
}
