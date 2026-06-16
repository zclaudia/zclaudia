import * as fs from 'fs';
import * as path from 'path';

export const VIRTUAL_MEMORY_ROOT = '/memories';
export const MAX_MEMORY_FILE_BYTES = 1024 * 1024;

export type MemoryTarget = { path: string };
export type MemoryViewRange = [number, number];

export type MemoryError = {
  ok: false;
  error: string;
  message: string;
  details?: Record<string, unknown>;
};

export type MemoryOk = { ok: true };
export type MemoryViewResult = MemoryOk & { kind: 'file' | 'directory'; text: string };
export type MemoryResult<T extends MemoryOk = MemoryOk> = T | MemoryError;

export interface MemoryProvider {
  read(target: MemoryTarget, range?: MemoryViewRange): Promise<MemoryResult<MemoryViewResult>>;
  list(target: MemoryTarget): Promise<MemoryResult<MemoryViewResult>>;
  create(target: MemoryTarget, content: string): Promise<MemoryResult>;
  replace(target: MemoryTarget, oldStr: string, newStr: string): Promise<MemoryResult>;
  insert(target: MemoryTarget, line: number, text: string): Promise<MemoryResult>;
  delete(target: MemoryTarget): Promise<MemoryResult>;
  rename(from: MemoryTarget, to: MemoryTarget): Promise<MemoryResult>;
}

type Resolved = { abs: string };
type ResolveFailure = { error: MemoryError };

function failure(error: string, message: string, details: Record<string, unknown> = {}): ResolveFailure {
  return { error: { ok: false, error, message, details } };
}

function opFailure(error: string, message: string, details: Record<string, unknown> = {}): MemoryError {
  return { ok: false, error, message, details };
}

/** Walk up from abs toward root, returning the nearest ancestor that already exists on disk. */
function nearestExistingAncestor(root: string, abs: string): string {
  let p = path.dirname(abs);
  while (p !== root && p.startsWith(root + path.sep) && !fs.existsSync(p)) {
    p = path.dirname(p);
  }
  return p;
}

function validateContentSize(content: string): MemoryError | undefined {
  const size = Buffer.byteLength(content, 'utf8');
  if (size <= MAX_MEMORY_FILE_BYTES) return undefined;
  return opFailure('content_too_large', `Memory file content is too large (${size} bytes; max ${MAX_MEMORY_FILE_BYTES}).`, {
    size,
    maxBytes: MAX_MEMORY_FILE_BYTES,
  });
}

function numberedLines(content: string, range?: MemoryViewRange): string {
  const lines = content.split('\n');
  const [start, end] = range ?? [1, lines.length];
  return lines
    .slice(Math.max(0, start - 1), end)
    .map((line, i) => `${start + i}\t${line}`)
    .join('\n');
}

export class FileSystemMemoryProvider implements MemoryProvider {
  private readonly root: string;

  constructor(memoryDir: string) {
    if (!memoryDir) {
      throw new Error('FileSystemMemoryProvider requires a non-empty memoryDir');
    }
    this.root = path.resolve(memoryDir);
  }

  private resolveVirtualPath(raw: unknown): Resolved | ResolveFailure {
    if (typeof raw !== 'string' || !raw.trim()) {
      return failure('invalid_path', `path is required and must start with ${VIRTUAL_MEMORY_ROOT}/`);
    }
    const trimmed = raw.trim();
    if (trimmed !== VIRTUAL_MEMORY_ROOT && !trimmed.startsWith(`${VIRTUAL_MEMORY_ROOT}/`)) {
      return failure('invalid_path', `path must start with ${VIRTUAL_MEMORY_ROOT}/ (got: ${trimmed})`);
    }
    const rootStat = fs.lstatSync(this.root, { throwIfNoEntry: false });
    if (rootStat?.isSymbolicLink()) {
      return failure('symlink_not_allowed', 'memory root cannot be a symlink');
    }
    const rel = trimmed === VIRTUAL_MEMORY_ROOT ? '' : trimmed.slice(VIRTUAL_MEMORY_ROOT.length + 1);
    const abs = path.resolve(this.root, rel);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      return failure('path_escape', 'path escapes the memory directory');
    }
    const lst = fs.lstatSync(abs, { throwIfNoEntry: false });
    if (lst?.isSymbolicLink()) {
      return failure('symlink_not_allowed', 'symlinks are not allowed in memory');
    }
    if (abs !== this.root) {
      const existingParent = nearestExistingAncestor(this.root, abs);
      if (existingParent !== this.root && existingParent.startsWith(this.root + path.sep) && fs.existsSync(existingParent)) {
        const realParent = fs.realpathSync(existingParent);
        const realRoot = fs.existsSync(this.root) ? fs.realpathSync(this.root) : this.root;
        if (realParent !== realRoot && !realParent.startsWith(realRoot + path.sep)) {
          return failure('symlink_not_allowed', 'memory path resolves outside the memory directory');
        }
      }
    }
    return { abs };
  }

  private listFiles(root: string): string {
    if (!fs.existsSync(root)) return '(no memories yet)';
    const entries = fs.readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const full = path.join(e.parentPath, e.name);
        const rel = path.relative(root, full);
        const size = fs.statSync(full).size;
        return `${VIRTUAL_MEMORY_ROOT}/${rel} (${size} bytes)`;
      })
      .sort();
    return entries.length ? entries.join('\n') : '(no memories yet)';
  }

  async list(target: MemoryTarget): Promise<MemoryResult<MemoryViewResult>> {
    const resolved = this.resolveVirtualPath(target.path);
    if ('error' in resolved) return resolved.error;
    return { ok: true, kind: 'directory', text: this.listFiles(resolved.abs) };
  }

  async read(target: MemoryTarget, range?: MemoryViewRange): Promise<MemoryResult<MemoryViewResult>> {
    const resolved = this.resolveVirtualPath(target.path);
    if ('error' in resolved) return resolved.error;
    const isRoot = resolved.abs === this.root;
    if (!fs.existsSync(resolved.abs)) {
      if (isRoot) return { ok: true, kind: 'directory', text: this.listFiles(resolved.abs) };
      return opFailure('not_found', `${target.path} does not exist`);
    }
    const stat = fs.statSync(resolved.abs);
    if (stat.isDirectory()) {
      return { ok: true, kind: 'directory', text: this.listFiles(resolved.abs) };
    }
    if (stat.size > MAX_MEMORY_FILE_BYTES) {
      return opFailure('content_too_large', `Memory file is too large to view (${stat.size} bytes; max ${MAX_MEMORY_FILE_BYTES}).`, {
        size: stat.size,
        maxBytes: MAX_MEMORY_FILE_BYTES,
      });
    }
    return { ok: true, kind: 'file', text: numberedLines(fs.readFileSync(resolved.abs, 'utf8'), range) };
  }

  async create(target: MemoryTarget, content: string): Promise<MemoryResult> {
    const resolved = this.resolveVirtualPath(target.path);
    if ('error' in resolved) return resolved.error;
    const sizeError = validateContentSize(content);
    if (sizeError) return sizeError;
    if (fs.existsSync(resolved.abs)) return opFailure('already_exists', `${target.path} already exists`);
    fs.mkdirSync(path.dirname(resolved.abs), { recursive: true });
    fs.writeFileSync(resolved.abs, content, 'utf8');
    return { ok: true };
  }

  async replace(target: MemoryTarget, oldStr: string, newStr: string): Promise<MemoryResult> {
    const resolved = this.resolveVirtualPath(target.path);
    if ('error' in resolved) return resolved.error;
    if (!fs.existsSync(resolved.abs)) return opFailure('not_found', `${target.path} does not exist`);
    const content = fs.readFileSync(resolved.abs, 'utf8');
    const occurrences = content.split(oldStr).length - 1;
    if (occurrences === 0) return opFailure('not_found', 'old_str not found in file — view the file and retry with exact text');
    if (occurrences > 1) return opFailure('not_unique', `old_str appears ${occurrences} times — include more surrounding context to make it unique`);
    const updated = content.replace(oldStr, newStr);
    const sizeError = validateContentSize(updated);
    if (sizeError) return sizeError;
    fs.writeFileSync(resolved.abs, updated, 'utf8');
    return { ok: true };
  }

  async insert(target: MemoryTarget, line: number, text: string): Promise<MemoryResult> {
    const resolved = this.resolveVirtualPath(target.path);
    if ('error' in resolved) return resolved.error;
    if (!fs.existsSync(resolved.abs)) return opFailure('not_found', `${target.path} does not exist`);
    const lines = fs.readFileSync(resolved.abs, 'utf8').split('\n');
    if (line > lines.length) return opFailure('invalid_params', `insert_line ${line} is beyond end of file (${lines.length} lines)`);
    lines.splice(line, 0, text);
    const updated = lines.join('\n');
    const sizeError = validateContentSize(updated);
    if (sizeError) return sizeError;
    fs.writeFileSync(resolved.abs, updated, 'utf8');
    return { ok: true };
  }

  async delete(target: MemoryTarget): Promise<MemoryResult> {
    const resolved = this.resolveVirtualPath(target.path);
    if ('error' in resolved) return resolved.error;
    if (resolved.abs === this.root) return opFailure('cannot_delete_root', `cannot delete ${VIRTUAL_MEMORY_ROOT} itself`);
    if (!fs.existsSync(resolved.abs)) return opFailure('not_found', `${target.path} does not exist`);
    if (fs.statSync(resolved.abs).isDirectory()) {
      return opFailure('cannot_delete_directory', 'delete refuses directories by default');
    }
    fs.rmSync(resolved.abs);
    return { ok: true };
  }

  async rename(from: MemoryTarget, to: MemoryTarget): Promise<MemoryResult> {
    const source = this.resolveVirtualPath(from.path);
    if ('error' in source) return source.error;
    const target = this.resolveVirtualPath(to.path);
    if ('error' in target) return target.error;
    if (!fs.existsSync(source.abs)) return opFailure('not_found', `${from.path} does not exist`);
    if (fs.existsSync(target.abs)) return opFailure('target_exists', `${to.path} already exists`);
    fs.mkdirSync(path.dirname(target.abs), { recursive: true });
    fs.renameSync(source.abs, target.abs);
    return { ok: true };
  }
}
