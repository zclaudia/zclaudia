import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import { FileBrowseError, FileBrowseService } from '../file-browse-service.js';

vi.mock('fs', async importOriginal => {
  const original = await importOriginal<typeof import('fs')>();
  return {
    ...original,
    existsSync: vi.fn(),
    statSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    openSync: vi.fn(),
    readSync: vi.fn(),
    closeSync: vi.fn(),
  };
});

vi.mock('os', async importOriginal => {
  const original = await importOriginal<typeof import('os')>();
  return { ...original, homedir: vi.fn(() => '/home/me') };
});

describe('FileBrowseService', () => {
  const service = new FileBrowseService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists directory entries with directories first', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockImplementation(target => {
      if (typeof target === 'string' && (target === '/project' || target.endsWith('src'))) {
        return { isDirectory: () => true, isFile: () => false } as fs.Stats;
      }
      return { isDirectory: () => false, isFile: () => true, size: 123 } as fs.Stats;
    });
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'index.ts', isDirectory: () => false, isFile: () => true },
      { name: 'src', isDirectory: () => true, isFile: () => false },
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    const result = service.listDirectory('/project', '', '', '50');

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].name).toBe('src');
    expect(result.entries[1].name).toBe('index.ts');
  });

  it('throws validation error for unsafe path traversal', () => {
    expect(() => service.listDirectory('/project', '../../../etc', '', '50')).toThrowError(
      FileBrowseError
    );
    try {
      service.listDirectory('/project', '../../../etc', '', '50');
    } catch (error) {
      expect(error).toBeInstanceOf(FileBrowseError);
      expect((error as FileBrowseError).code).toBe('FORBIDDEN');
    }
  });

  it('reads text file content', () => {
    const fileContent = 'export const hello = "world";';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => false,
      size: fileContent.length,
    } as fs.Stats);
    vi.mocked(fs.readFileSync).mockReturnValue(fileContent as never);
    vi.mocked(fs.readSync).mockImplementation((_fd, buf: Buffer) => {
      const bytes = Buffer.from(fileContent);
      bytes.copy(buf, 0, 0, Math.min(bytes.length, buf.length));
      return bytes.length;
    });

    const result = service.readFileContent('/project', 'index.ts');

    expect(result.content).toBe(fileContent);
    expect(result.path).toBe('index.ts');
  });

  describe('browseDirectories', () => {
    it('defaults to the home directory when no path is given', () => {
      vi.mocked(os.homedir).mockReturnValue('/home/me');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
      vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);

      const result = service.browseDirectories(undefined);

      expect(result.path).toBe('/home/me');
      expect(result.parent).toBe('/home');
    });

    it('returns only subdirectories, skipping hidden and ignored dirs, sorted', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'README.md', isDirectory: () => false, isFile: () => true },
        { name: 'zebra', isDirectory: () => true, isFile: () => false },
        { name: 'node_modules', isDirectory: () => true, isFile: () => false },
        { name: '.git', isDirectory: () => true, isFile: () => false },
        { name: 'alpha', isDirectory: () => true, isFile: () => false },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const result = service.browseDirectories('/code');

      expect(result.directories.map(d => d.name)).toEqual(['alpha', 'zebra']);
      expect(result.directories[0].path).toBe('/code/alpha');
      expect(result.path).toBe('/code');
      expect(result.parent).toBe('/');
    });

    it('reports null parent at the filesystem root', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
      vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);

      const result = service.browseDirectories('/');

      expect(result.parent).toBeNull();
    });

    it('throws NOT_FOUND when the path does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      try {
        service.browseDirectories('/missing');
        expect.unreachable();
      } catch (error) {
        expect((error as FileBrowseError).code).toBe('NOT_FOUND');
      }
    });

    it('throws INVALID_PATH when the path is a file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false } as fs.Stats);
      try {
        service.browseDirectories('/code/file.txt');
        expect.unreachable();
      } catch (error) {
        expect((error as FileBrowseError).code).toBe('INVALID_PATH');
      }
    });
  });

  it('rejects binary files', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => false,
      size: 4,
    } as fs.Stats);
    vi.mocked(fs.readSync).mockImplementation((_fd, buf: Buffer) => {
      buf[0] = 0;
      return 1;
    });

    expect(() => service.readFileContent('/project', 'image.dat')).toThrowError(FileBrowseError);
    try {
      service.readFileContent('/project', 'image.dat');
    } catch (error) {
      expect((error as FileBrowseError).code).toBe('BINARY_FILE');
    }
  });
});
