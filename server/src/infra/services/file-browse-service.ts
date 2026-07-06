import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  DirectoryBrowseResponse,
  DirectoryListingResponse,
  FileContentResponse,
  FileStatResponse,
  FileEntry,
} from '@zclaudia/shared/files';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'target',
  'vendor',
  '.idea',
  '.vscode',
  'coverage',
  '.nyc_output',
]);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.svg',
  '.tiff',
  '.tif',
  '.avif',
  '.mp3',
  '.mp4',
  '.wav',
  '.ogg',
  '.flac',
  '.avi',
  '.mov',
  '.mkv',
  '.webm',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.zst',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.a',
  '.o',
  '.obj',
  '.bin',
  '.apk',
  '.aab',
  '.ipa',
  '.deb',
  '.rpm',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.class',
  '.pyc',
  '.pyo',
  '.wasm',
  '.DS_Store',
]);

function isBinaryExtension(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function isPathSafe(projectRoot: string, targetPath: string): boolean {
  const resolvedPath = path.resolve(projectRoot, targetPath);
  const normalizedRoot = path.resolve(projectRoot);
  return resolvedPath.startsWith(normalizedRoot + path.sep) || resolvedPath === normalizedRoot;
}

function getExtension(name: string, isDir: boolean): string | undefined {
  if (isDir) return undefined;
  const ext = path.extname(name);
  return ext || undefined;
}

function fuzzyMatch(query: string, name: string): boolean {
  if (!query) return true;
  return name.toLowerCase().includes(query.toLowerCase());
}

function recursiveFileSearch(
  rootDir: string,
  projectRoot: string,
  query: string,
  maxResults: number
): { entries: FileEntry[]; hasMore: boolean } {
  const entries: FileEntry[] = [];
  let hasMore = false;

  function walk(dir: string) {
    if (hasMore) return;
    let dirEntries: fs.Dirent[];
    try {
      dirEntries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      if (hasMore) return;
      if (entry.name.startsWith('.')) continue;

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        if (isBinaryExtension(entry.name)) continue;
        if (!fuzzyMatch(query, entry.name)) continue;
        if (entries.length >= maxResults) {
          hasMore = true;
          return;
        }

        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(projectRoot, fullPath);
        let size: number | undefined;
        try {
          size = fs.statSync(fullPath).size;
        } catch {
          // ignore
        }

        entries.push({
          name: entry.name,
          path: relPath,
          type: 'file',
          extension: getExtension(entry.name, false),
          size,
        });
      }
    }
  }

  walk(rootDir);
  return { entries, hasMore };
}

export class FileBrowseError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export class FileBrowseService {
  listDirectory(
    projectRoot: string | undefined,
    relativePath: string,
    query: string,
    maxResults: string
  ): DirectoryListingResponse {
    if (!projectRoot) {
      throw new FileBrowseError(400, 'VALIDATION_ERROR', 'projectRoot is required');
    }

    const normalizedRelPath = relativePath.replace(/^\/+|\/+$/g, '');
    if (!isPathSafe(projectRoot, normalizedRelPath)) {
      throw new FileBrowseError(403, 'FORBIDDEN', 'Path traversal not allowed');
    }

    const targetPath = path.join(projectRoot, normalizedRelPath);
    if (!fs.existsSync(targetPath)) {
      throw new FileBrowseError(404, 'NOT_FOUND', 'Directory not found');
    }

    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      throw new FileBrowseError(400, 'INVALID_PATH', 'Path is not a directory');
    }

    const maxResultsNum = parseInt(maxResults, 10) || 50;
    let entries: FileEntry[];
    let hasMore: boolean;

    if (query && !normalizedRelPath) {
      const result = recursiveFileSearch(targetPath, projectRoot, query, maxResultsNum);
      entries = result.entries;
      hasMore = result.hasMore;
      entries.sort((a, b) => a.path.localeCompare(b.path));
    } else {
      const dirEntries = fs.readdirSync(targetPath, { withFileTypes: true });
      entries = [];
      hasMore = false;

      for (const entry of dirEntries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
        if (query && entry.isFile() && isBinaryExtension(entry.name)) continue;
        if (!fuzzyMatch(query, entry.name)) continue;

        if (entries.length >= maxResultsNum) {
          hasMore = true;
          break;
        }

        const entryPath = normalizedRelPath ? `${normalizedRelPath}/${entry.name}` : entry.name;
        const fullPath = path.join(targetPath, entry.name);
        let size: number | undefined;
        if (entry.isFile()) {
          try {
            size = fs.statSync(fullPath).size;
          } catch {
            // ignore
          }
        }

        entries.push({
          name: entry.name,
          path: entryPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          extension: getExtension(entry.name, entry.isDirectory()),
          size,
        });
      }

      entries.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    }

    return {
      entries,
      currentPath: normalizedRelPath,
      hasMore,
    };
  }

  /**
   * Browse directories for the project-root picker. Lists immediate
   * subdirectories of an absolute path on the backend host (defaulting to the
   * home directory), returning the resolved path and its parent so the client
   * can navigate without doing OS-specific path math.
   */
  browseDirectories(absPath: string | undefined): DirectoryBrowseResponse {
    const base = absPath && absPath.trim() ? path.resolve(absPath) : os.homedir();

    if (!fs.existsSync(base)) {
      throw new FileBrowseError(404, 'NOT_FOUND', 'Directory not found');
    }
    if (!fs.statSync(base).isDirectory()) {
      throw new FileBrowseError(400, 'INVALID_PATH', 'Path is not a directory');
    }

    const directories = fs
      .readdirSync(base, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => !entry.name.startsWith('.'))
      .filter(entry => !IGNORED_DIRS.has(entry.name))
      .map(entry => ({ name: entry.name, path: path.join(base, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = path.dirname(base);
    return {
      path: base,
      parent: parent === base ? null : parent,
      directories,
    };
  }

  readFileContent(
    projectRoot: string | undefined,
    relativePath: string | undefined
  ): FileContentResponse {
    if (!projectRoot || !relativePath) {
      throw new FileBrowseError(
        400,
        'VALIDATION_ERROR',
        'projectRoot and relativePath are required'
      );
    }

    if (!isPathSafe(projectRoot, relativePath)) {
      throw new FileBrowseError(403, 'FORBIDDEN', 'Path traversal not allowed');
    }

    const fullPath = path.join(projectRoot, relativePath);
    if (!fs.existsSync(fullPath)) {
      throw new FileBrowseError(404, 'NOT_FOUND', 'File not found');
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      throw new FileBrowseError(400, 'INVALID_PATH', 'Path is a directory, not a file');
    }

    const MAX_FILE_SIZE = 1024 * 1024;
    if (stat.size > MAX_FILE_SIZE) {
      throw new FileBrowseError(400, 'FILE_TOO_LARGE', 'File is too large (max 1MB)');
    }

    const probeSize = Math.min(8192, stat.size);
    if (probeSize > 0) {
      const fd = fs.openSync(fullPath, 'r');
      const buf = Buffer.alloc(probeSize);
      fs.readSync(fd, buf, 0, probeSize, 0);
      fs.closeSync(fd);
      if (buf.includes(0)) {
        throw new FileBrowseError(400, 'BINARY_FILE', 'Binary files cannot be viewed as text');
      }
    }

    return {
      path: relativePath,
      content: fs.readFileSync(fullPath, 'utf-8'),
      size: stat.size,
    };
  }

  /**
   * Returns lightweight file metadata (mtime + size) without reading contents.
   * Used by clients to poll for external file changes. Does NOT reject binary
   * files or enforce the 1MB size cap — those checks only matter when reading
   * content.
   */
  statFile(projectRoot: string | undefined, relativePath: string | undefined): FileStatResponse {
    if (!projectRoot || !relativePath) {
      throw new FileBrowseError(
        400,
        'VALIDATION_ERROR',
        'projectRoot and relativePath are required'
      );
    }

    if (!isPathSafe(projectRoot, relativePath)) {
      throw new FileBrowseError(403, 'FORBIDDEN', 'Path traversal not allowed');
    }

    const fullPath = path.join(projectRoot, relativePath);
    if (!fs.existsSync(fullPath)) {
      throw new FileBrowseError(404, 'NOT_FOUND', 'File not found');
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      throw new FileBrowseError(400, 'INVALID_PATH', 'Path is a directory, not a file');
    }

    return {
      path: relativePath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
  }
}
