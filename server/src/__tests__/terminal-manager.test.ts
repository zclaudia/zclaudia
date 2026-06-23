import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';

// Mock node-pty
const mockPtyKill = vi.fn();
const mockPtyWrite = vi.fn();
const mockPtyResize = vi.fn();
let mockOnDataCallback: ((data: string) => void) | null = null;
let mockOnExitCallback: ((e: { exitCode: number }) => void) | null = null;

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    onData: (cb: (data: string) => void) => { mockOnDataCallback = cb; },
    onExit: (cb: (e: { exitCode: number }) => void) => { mockOnExitCallback = cb; },
    write: mockPtyWrite,
    resize: mockPtyResize,
    kill: mockPtyKill,
  })),
}));

// Mock child_process for detectShell WSL detection
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

import { TerminalManager, isProtectedTccDir } from '../terminal-manager.js';
import * as pty from 'node-pty';

describe('isProtectedTccDir', () => {
  const originalPlatform = process.platform;
  const originalHome = process.env.HOME;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
  });

  function asDarwin(home: string) {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.HOME = home;
  }

  it('returns true for ~/Desktop, ~/Documents, ~/Downloads and their descendants', () => {
    asDarwin('/Users/test');
    for (const base of ['Desktop', 'Documents', 'Downloads']) {
      expect(isProtectedTccDir(`/Users/test/${base}`)).toBe(true);
      expect(isProtectedTccDir(`/Users/test/${base}/proj`)).toBe(true);
      expect(isProtectedTccDir(`/Users/test/${base}/a/b/c`)).toBe(true);
      // trailing slash tolerated
      expect(isProtectedTccDir(`/Users/test/${base}/`)).toBe(true);
    }
  });

  it('is case-insensitive on the protected folder name', () => {
    asDarwin('/Users/test');
    expect(isProtectedTccDir('/Users/test/desktop')).toBe(true);
    expect(isProtectedTccDir('/Users/test/DOCUMENTS/x')).toBe(true);
  });

  it('returns false for non-protected dirs and paths outside $HOME', () => {
    asDarwin('/Users/test');
    expect(isProtectedTccDir('/Users/test/Code/proj')).toBe(false);
    expect(isProtectedTccDir('/Users/test/DesktopX')).toBe(false); // not the Desktop folder
    expect(isProtectedTccDir('/tmp')).toBe(false);
    expect(isProtectedTccDir('/home/test/project')).toBe(false);
  });

  it('returns false on non-darwin platforms regardless of path', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.HOME = '/home/test';
    expect(isProtectedTccDir('/home/test/Desktop/proj')).toBe(false);
  });
});

describe('TerminalManager', () => {
  let manager: TerminalManager;
  let sentMessages: Array<{ clientId: string; msg: ServerMessage }>;

  beforeEach(() => {
    vi.useFakeTimers();
    sentMessages = [];
    manager = new TerminalManager((clientId, msg) => {
      sentMessages.push({ clientId, msg });
    });
    mockOnDataCallback = null;
    mockOnExitCallback = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    manager.destroyAll();
    vi.useRealTimers();
  });

  describe('create', () => {
    it('spawns a PTY directly at a non-protected cwd without cd', () => {
      // A normal project dir (not under ~/{Desktop,Documents,Downloads}) is
      // used directly as the spawn cwd — no $HOME fallback, no cd.
      manager.create('term-1', 'client-1', '/home/test/project', 80, 24);

      expect(pty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        [],
        expect.objectContaining({
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: '/home/test/project',
        }),
      );
      // No cd should be written: the shell already started in the target dir.
      expect(mockPtyWrite).not.toHaveBeenCalledWith(expect.stringContaining('cd '));
    });

    it('falls back to $HOME + cd for macOS TCC-protected directories', () => {
      const originalPlatform = process.platform;
      const originalHome = process.env.HOME;
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      process.env.HOME = '/Users/test';

      try {
        manager.create('term-1', 'client-1', '/Users/test/Desktop/proj', 80, 24);

        // Spawns at $HOME (protected dirs block a direct spawn via a TCC prompt)
        expect(pty.spawn).toHaveBeenCalledWith(
          expect.any(String),
          [],
          expect.objectContaining({
            cwd: '/Users/test',
          }),
        );
        // Then cd into the actual target dir
        expect(mockPtyWrite).toHaveBeenCalledWith(expect.stringContaining('/Users/test/Desktop/proj'));
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        if (originalHome !== undefined) process.env.HOME = originalHome;
      }
    });

    it('sends terminal_output when PTY emits data', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      expect(mockOnDataCallback).not.toBeNull();

      mockOnDataCallback!('hello world');

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]).toEqual({
        clientId: 'client-1',
        msg: { type: 'terminal_output', terminalId: 'term-1', data: 'hello world' },
      });
    });

    it('sends terminal_exited when PTY exits', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      expect(mockOnExitCallback).not.toBeNull();

      mockOnExitCallback!({ exitCode: 0 });

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]).toEqual({
        clientId: 'client-1',
        msg: { type: 'terminal_exited', terminalId: 'term-1', exitCode: 0 },
      });
    });

    it('destroys existing terminal with same ID before creating new one', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      manager.create('term-1', 'client-2', '/tmp', 100, 30);

      expect(mockPtyKill).toHaveBeenCalledTimes(1); // old one killed
      expect(pty.spawn).toHaveBeenCalledTimes(2);
    });
  });

  describe('write', () => {
    it('writes data to the PTY', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      manager.write('term-1', 'ls\n');

      expect(mockPtyWrite).toHaveBeenCalledWith('ls\n');
    });

    it('does nothing for non-existent terminal', () => {
      manager.write('non-existent', 'data');
      expect(mockPtyWrite).not.toHaveBeenCalled();
    });

    it('resets idle timer on write', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      vi.clearAllMocks(); // Clear cd write from create

      // Advance 29 minutes
      vi.advanceTimersByTime(29 * 60 * 1000);

      // Write resets the timer
      manager.write('term-1', 'x');

      // Advance another 29 minutes — should still be alive because timer was reset
      vi.advanceTimersByTime(29 * 60 * 1000);
      manager.write('term-1', 'y');
      expect(mockPtyWrite).toHaveBeenCalledTimes(2);

      // Now advance 30 minutes without writing — idle timeout fires
      vi.advanceTimersByTime(30 * 60 * 1000);
      expect(mockPtyKill).toHaveBeenCalled();
    });
  });

  describe('resize', () => {
    it('resizes the PTY', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      manager.resize('term-1', 120, 40);

      expect(mockPtyResize).toHaveBeenCalledWith(120, 40);
    });

    it('does nothing for non-existent terminal', () => {
      manager.resize('non-existent', 120, 40);
      expect(mockPtyResize).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('kills the PTY and removes from map', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      vi.clearAllMocks(); // Clear cd write from create
      manager.destroy('term-1');

      expect(mockPtyKill).toHaveBeenCalledTimes(1);

      // Write to destroyed terminal should be no-op
      manager.write('term-1', 'data');
      expect(mockPtyWrite).not.toHaveBeenCalled();
    });

    it('does nothing for non-existent terminal', () => {
      manager.destroy('non-existent');
      expect(mockPtyKill).not.toHaveBeenCalled();
    });
  });

  describe('destroyForClient', () => {
    it('destroys all terminals belonging to a client', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      vi.clearAllMocks();
      manager.create('term-2', 'client-1', '/tmp', 80, 24);
      vi.clearAllMocks();
      manager.create('term-3', 'client-2', '/tmp', 80, 24);
      vi.clearAllMocks();

      manager.destroyForClient('client-1');

      expect(mockPtyKill).toHaveBeenCalledTimes(2);

      // client-2's terminal should still work
      manager.write('term-3', 'data');
      expect(mockPtyWrite).toHaveBeenCalled();
    });

    it('does nothing when client has no terminals', () => {
      manager.destroyForClient('no-such-client');
      expect(mockPtyKill).not.toHaveBeenCalled();
    });
  });

  describe('detachClient', () => {
    it('detaches terminals without killing the PTY', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      vi.clearAllMocks();

      manager.detachClient('client-1');
      mockOnDataCallback?.('buffered output');

      expect(mockPtyKill).not.toHaveBeenCalled();
      expect(sentMessages).toHaveLength(0);

      manager.attach('term-1', 'client-2', 100, 30);
      expect(mockPtyResize).toHaveBeenCalledWith(100, 30);

      mockOnDataCallback?.('live output');
      expect(sentMessages).toEqual([
        {
          clientId: 'client-2',
          msg: { type: 'terminal_output', terminalId: 'term-1', data: 'live output' },
        },
      ]);
    });
  });

  describe('destroyAll', () => {
    it('destroys all terminals', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      vi.clearAllMocks();
      manager.create('term-2', 'client-2', '/tmp', 80, 24);
      vi.clearAllMocks();

      manager.destroyAll();

      expect(mockPtyKill).toHaveBeenCalledTimes(2);

      // All terminals should be gone
      manager.write('term-1', 'data');
      manager.write('term-2', 'data');
      expect(mockPtyWrite).not.toHaveBeenCalled();
    });
  });

  describe('attach + detached exit', () => {
    it('isOwnedBy returns true for the current owner only', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      expect(manager.isOwnedBy('term-1', 'client-1')).toBe(true);
      expect(manager.isOwnedBy('term-1', 'client-2')).toBe(false);
      expect(manager.isOwnedBy('missing', 'client-1')).toBe(false);
    });

    it('attach switches ownership and returns scrollback', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      mockOnDataCallback?.('hello\r\n');
      sentMessages.length = 0;

      const result = manager.attach('term-1', 'client-2', 100, 30);

      expect(result.success).toBe(true);
      expect(result.scrollback).toEqual(['hello\r\n']);
      expect(result.pendingExit).toBeUndefined();
      expect(manager.isOwnedBy('term-1', 'client-2')).toBe(true);
    });

    it('detached PTY exit is held for the next attach with pendingExit', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      mockOnDataCallback?.('shell$ ');
      manager.detachTerminal('term-1', 'client-1');
      sentMessages.length = 0;

      // PTY exits while no client is attached — must NOT broadcast and must NOT delete the entry yet
      mockOnExitCallback?.({ exitCode: 137 });
      expect(sentMessages).toHaveLength(0);

      // Next attach gets the scrollback + the pendingExit, then the entry is gone
      const result = manager.attach('term-1', 'client-2', 80, 24);
      expect(result.success).toBe(true);
      expect(result.scrollback).toEqual(['shell$ ']);
      expect(result.pendingExit).toEqual({ exitCode: 137 });

      const followUp = manager.attach('term-1', 'client-3', 80, 24);
      expect(followUp.success).toBe(false);
      expect(followUp.error).toBe('Terminal not found');
    });

    it('owned PTY exit broadcasts terminal_exited and deletes the entry immediately', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      sentMessages.length = 0;

      mockOnExitCallback?.({ exitCode: 0 });

      expect(sentMessages).toContainEqual({
        clientId: 'client-1',
        msg: { type: 'terminal_exited', terminalId: 'term-1', exitCode: 0 },
      });
      const result = manager.attach('term-1', 'client-2', 80, 24);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Terminal not found');
    });
  });

  describe('idle timeout', () => {
    it('destroys terminal after 30 minutes of inactivity', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      vi.clearAllMocks(); // Clear cd write from create

      vi.advanceTimersByTime(30 * 60 * 1000);

      expect(mockPtyKill).toHaveBeenCalledTimes(1);

      // Terminal should be gone
      manager.write('term-1', 'data');
      expect(mockPtyWrite).not.toHaveBeenCalled();
    });

    it('does not destroy terminal before 30 minutes', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);

      vi.advanceTimersByTime(29 * 60 * 1000);

      expect(mockPtyKill).not.toHaveBeenCalled();
    });
  });

  describe('shell detection (cross-platform)', () => {
    const originalPlatform = process.platform;
    const originalShell = process.env.SHELL;
    const originalComspec = process.env.COMSPEC;

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      if (originalShell !== undefined) {
        process.env.SHELL = originalShell;
      } else {
        delete process.env.SHELL;
      }
      if (originalComspec !== undefined) {
        process.env.COMSPEC = originalComspec;
      } else {
        delete process.env.COMSPEC;
      }
    });

    it('uses $SHELL on Linux/macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.SHELL = '/bin/zsh';

      manager.create('term-1', 'client-1', '/tmp', 80, 24);

      expect(pty.spawn).toHaveBeenCalledWith(
        '/bin/zsh',
        [],
        expect.any(Object),
      );
    });

    it('falls back to bash on Linux/macOS when $SHELL is unset', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      delete process.env.SHELL;

      manager.create('term-1', 'client-1', '/tmp', 80, 24);

      expect(pty.spawn).toHaveBeenCalledWith(
        'bash',
        [],
        expect.any(Object),
      );
    });

    it('uses wsl.exe on Windows when WSL is available', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      delete process.env.SHELL;
      mockExecSync.mockReturnValue(Buffer.from(''));

      // Need a fresh TerminalManager so detectShell runs for win32
      const winManager = new TerminalManager((clientId, msg) => {
        sentMessages.push({ clientId, msg });
      });

      winManager.create('term-1', 'client-1', 'C:\\Users\\test', 80, 24);

      expect(pty.spawn).toHaveBeenCalledWith(
        'wsl.exe',
        [],
        expect.any(Object),
      );

      winManager.destroyAll();
    });

    it('falls back to powershell.exe on Windows when WSL is not available', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      delete process.env.SHELL;
      delete process.env.COMSPEC;
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });

      const winManager = new TerminalManager((clientId, msg) => {
        sentMessages.push({ clientId, msg });
      });

      winManager.create('term-1', 'client-1', 'C:\\Users\\test', 80, 24);

      expect(pty.spawn).toHaveBeenCalledWith(
        'powershell.exe',
        [],
        expect.any(Object),
      );

      winManager.destroyAll();
    });

    it('uses COMSPEC on Windows when WSL is not available and COMSPEC is set', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      delete process.env.SHELL;
      process.env.COMSPEC = 'C:\\Windows\\system32\\cmd.exe';
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });

      const winManager = new TerminalManager((clientId, msg) => {
        sentMessages.push({ clientId, msg });
      });

      winManager.create('term-1', 'client-1', 'C:\\Users\\test', 80, 24);

      expect(pty.spawn).toHaveBeenCalledWith(
        'C:\\Windows\\system32\\cmd.exe',
        [],
        expect.any(Object),
      );

      winManager.destroyAll();
    });
  });
});
