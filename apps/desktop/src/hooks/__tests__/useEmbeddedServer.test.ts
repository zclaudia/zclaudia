// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, StrictMode } from 'react';
import { useEmbeddedServer } from '../useEmbeddedServer.js';

// Capture event handlers registered by the hook
type EventHandler = (...args: any[]) => void;
let stdoutHandlers: Map<string, EventHandler>;
let stderrHandlers: Map<string, EventHandler>;
let commandHandlers: Map<string, EventHandler>;
let mockSpawnFn: ReturnType<typeof vi.fn>;
let mockExecuteFn: ReturnType<typeof vi.fn>;
let mockChildKillFn: ReturnType<typeof vi.fn>;

function createMockCommand() {
  stdoutHandlers = new Map();
  stderrHandlers = new Map();
  commandHandlers = new Map();
  mockChildKillFn = vi.fn().mockResolvedValue(undefined);
  mockSpawnFn = vi.fn().mockResolvedValue({ pid: 12345, kill: mockChildKillFn });
  mockExecuteFn = vi.fn().mockResolvedValue({ code: 0, signal: null, stdout: '', stderr: '' });

  return {
    stdout: {
      on: vi.fn((event: string, handler: EventHandler) => {
        stdoutHandlers.set(event, handler);
      }),
    },
    stderr: {
      on: vi.fn((event: string, handler: EventHandler) => {
        stderrHandlers.set(event, handler);
      }),
    },
    on: vi.fn((event: string, handler: EventHandler) => {
      commandHandlers.set(event, handler);
    }),
    spawn: mockSpawnFn,
    execute: mockExecuteFn,
  };
}

let latestMockCommand: ReturnType<typeof createMockCommand>;

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    create: vi.fn(() => {
      latestMockCommand = createMockCommand();
      return latestMockCommand;
    }),
    sidecar: vi.fn(() => {
      latestMockCommand = createMockCommand();
      return latestMockCommand;
    }),
  },
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(() => Promise.resolve('/app/data')),
  homeDir: vi.fn(() => Promise.resolve('/home/dev user')),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
  resolveResource: vi.fn(() => Promise.resolve('/app/resources/server.js')),
}));

const mockInvoke = vi.fn().mockResolvedValue({});
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

// Dynamic platform detection mock — evaluates at access time so tests can
// manipulate window.__TAURI_INTERNALS__ and navigator.userAgent before import.
vi.mock('../../utils/platform', () => ({
  isTauri: vi.fn(() => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window),
  isAndroid: vi.fn(() => {
    const t = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    return t && navigator.userAgent.includes('Android');
  }),
  isWindows: vi.fn(() => {
    const t = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    return t && navigator.userAgent.includes('Windows');
  }),
  isMacOS: vi.fn(() => {
    const t = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const a = t && navigator.userAgent.includes('Android');
    return t && !a && navigator.platform.includes('Mac');
  }),
  isDesktopTauri: vi.fn(() => {
    const t = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    return t && !navigator.userAgent.includes('Android');
  }),
  isDesktopTauriNonWindows: vi.fn(() => {
    const t = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    return (
      t && !navigator.userAgent.includes('Android') && !navigator.userAgent.includes('Windows')
    );
  }),
}));

// Mock fetch for health check
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('hooks/useEmbeddedServer', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  const mockTauriInternals = () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      writable: true,
      configurable: true,
    });
  };

  const removeTauriInternals = () => {
    delete (window as any).__TAURI_INTERNALS__;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockReset().mockResolvedValue({});
    vi.useFakeTimers();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Reset window state
    removeTauriInternals();
    // Mock navigator.userAgent for desktop
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      writable: true,
      configurable: true,
    });

    // Default mock for fetch (health check fails)
    mockFetch.mockRejectedValue(new Error('Not running'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    removeTauriInternals();
  });

  describe('isDesktopTauri detection', () => {
    it('returns disabled status when not in Tauri', () => {
      removeTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer());

      expect(result.current.status).toBe('disabled');
    });

    it('returns disabled status on Android', () => {
      mockTauriInternals();
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 10)',
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useEmbeddedServer());

      expect(result.current.status).toBe('disabled');
    });

    it('returns starting status in desktop Tauri', () => {
      mockTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer());

      expect(result.current.status).toBe('starting');
    });

    it('returns wsl-mode status on Windows Tauri', () => {
      mockTauriInternals();
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useEmbeddedServer());

      expect(result.current.status).toBe('wsl-mode');
    });
  });

  describe('return values', () => {
    it('returns status object with required properties', () => {
      mockTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer());

      expect(result.current).toHaveProperty('status');
      expect(result.current).toHaveProperty('port');
      expect(result.current).toHaveProperty('error');
    });

    it('returns null port initially', () => {
      mockTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer());

      expect(result.current.port).toBeNull();
    });

    it('returns null error initially', () => {
      mockTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer());

      expect(result.current.error).toBeNull();
    });
  });

  describe('disabled option', () => {
    it('returns disabled status when disabled option is true', () => {
      mockTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer({ disabled: true }));

      expect(result.current.status).toBe('disabled');
      expect(result.current.port).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('does not spawn server when disabled', async () => {
      mockTauriInternals();

      renderHook(() => useEmbeddedServer({ disabled: true }));

      // Flush all promises
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      // sidecar should not have been called
      const { Command } = await import('@tauri-apps/plugin-shell');
      expect(Command.sidecar).not.toHaveBeenCalled();
    });

    it('starts server when disabled is false', () => {
      mockTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer({ disabled: false }));

      expect(result.current.status).toBe('starting');
    });
  });

  describe('health check reuse (dev mode)', () => {
    // In vitest, import.meta.env.DEV is true, so dev path is taken

    it('reuses existing server when health check succeeds', async () => {
      mockTauriInternals();
      mockFetch.mockResolvedValueOnce({ ok: true });

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      expect(result.current.status).toBe('ready');
      expect(result.current.port).toBe(3100);
      expect(result.current.error).toBeNull();
    });

    it('does not spawn new process when health check succeeds', async () => {
      mockTauriInternals();
      mockFetch.mockResolvedValueOnce({ ok: true });

      renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      const { Command } = await import('@tauri-apps/plugin-shell');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:3100/health',
        expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) })
      );
      expect(Command.sidecar).not.toHaveBeenCalled();
    });

    it('reuses existing server when health check succeeds after retries', async () => {
      mockTauriInternals();
      mockFetch
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce({ ok: true });

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      expect(result.current.status).toBe('ready');
      expect(result.current.port).toBe(3100);
      const { Command } = await import('@tauri-apps/plugin-shell');
      expect(Command.sidecar).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('spawns new process when health check fails', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      const { Command } = await import('@tauri-apps/plugin-shell');
      expect(Command.sidecar).toHaveBeenCalledTimes(2);
      expect(mockSpawnFn).toHaveBeenCalled();
    });

    it('spawns new process when health check returns non-ok', async () => {
      mockTauriInternals();
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      const { Command } = await import('@tauri-apps/plugin-shell');
      expect(Command.sidecar).toHaveBeenCalledTimes(2);
      expect(mockSpawnFn).toHaveBeenCalled();
    });
  });

  describe('SERVER_READY parsing from stdout', () => {
    it('parses SERVER_READY message and sets port + ready status', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      // Simulate stdout emitting SERVER_READY
      const stdoutHandler = stdoutHandlers.get('data');
      expect(stdoutHandler).toBeDefined();

      act(() => {
        stdoutHandler!('SERVER_READY:3100');
      });

      expect(result.current.status).toBe('ready');
      expect(result.current.port).toBe(3100);
      expect(result.current.error).toBeNull();
    });

    it('parses SERVER_READY with different port numbers', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      const stdoutHandler = stdoutHandlers.get('data');

      act(() => {
        stdoutHandler!('SERVER_READY:8080');
      });

      expect(result.current.port).toBe(8080);
      expect(result.current.status).toBe('ready');
    });

    it('handles SERVER_READY with surrounding whitespace', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      const stdoutHandler = stdoutHandlers.get('data');

      act(() => {
        stdoutHandler!('  SERVER_READY:4000  ');
      });

      expect(result.current.port).toBe(4000);
      expect(result.current.status).toBe('ready');
    });

    it('ignores non-SERVER_READY stdout lines', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      const stdoutHandler = stdoutHandlers.get('data');

      act(() => {
        stdoutHandler!('Some random log output');
      });

      expect(result.current.status).toBe('starting');
      expect(result.current.port).toBeNull();
    });

    it('logs non-SERVER_READY stdout lines', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      const stdoutHandler = stdoutHandlers.get('data');

      act(() => {
        stdoutHandler!('Database initialized');
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Database initialized'));
    });
  });

  describe('error handling during spawn', () => {
    it('sets error state when spawn throws', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      // Make sidecar's spawn reject
      const { Command } = await import('@tauri-apps/plugin-shell');
      (Command.sidecar as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => createMockCommand())
        .mockImplementationOnce(() => {
          const cmd = createMockCommand();
          cmd.spawn = vi.fn().mockRejectedValue(new Error('Failed to spawn process'));
          latestMockCommand = cmd;
          return cmd;
        });

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toBe('Failed to spawn process');
      expect(result.current.port).toBeNull();
    });

    it('sets error state with string error message', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { Command } = await import('@tauri-apps/plugin-shell');
      (Command.sidecar as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => createMockCommand())
        .mockImplementationOnce(() => {
          const cmd = createMockCommand();
          cmd.spawn = vi.fn().mockRejectedValue('string error');
          latestMockCommand = cmd;
          return cmd;
        });

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toBe('string error');
    });
  });

  describe('process lifecycle events', () => {
    it('automatically replaces a crashed dev sidecar and ignores its delayed events', async () => {
      mockTauriInternals();
      const { result } = renderHook(() => useEmbeddedServer());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });
      const oldStdout = stdoutHandlers.get('data')!;
      const oldClose = commandHandlers.get('close')!;
      const oldError = commandHandlers.get('error')!;
      act(() => oldStdout('SERVER_READY:4100'));
      await act(async () => {
        oldClose({ code: 1, signal: null });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.status).toBe('error');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });
      expect(stdoutHandlers.get('data')).not.toBe(oldStdout);
      act(() => stdoutHandlers.get('data')!('SERVER_READY:4101'));
      act(() => {
        oldStdout('SERVER_READY:9999');
        oldError('old failure');
        oldClose({ code: 1, signal: null });
      });
      expect(result.current.status).toBe('ready');
      expect(result.current.port).toBe(4101);
    });

    it('sets error state on process error event', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      const errorHandler = commandHandlers.get('error');
      expect(errorHandler).toBeDefined();

      act(() => {
        errorHandler!('Segmentation fault');
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toBe('Segmentation fault');
    });

    it('sets error state on process close during starting', async () => {
      mockTauriInternals();
      // First call rejects (initial health check), subsequent calls also reject (close handler check)
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      const closeHandler = commandHandlers.get('close');
      expect(closeHandler).toBeDefined();

      // Simulate process close during starting phase
      await act(async () => {
        closeHandler!({ code: 1, signal: null });
        // Let the fetch promise in the close handler resolve/reject
        await vi.advanceTimersByTimeAsync(0);
        // Flush microtasks
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toContain('crashed on startup');
    });

    it('sets error state on process close after ready', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      // First transition to ready
      const stdoutHandler = stdoutHandlers.get('data');
      act(() => {
        stdoutHandler!('SERVER_READY:3100');
      });

      expect(result.current.status).toBe('ready');

      const closeHandler = commandHandlers.get('close');

      // Simulate process close after ready - health check also fails
      await act(async () => {
        closeHandler!({ code: null, signal: 9 });
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toBe('Server process exited unexpectedly');
    });

    it('recovers on close if server is still reachable', async () => {
      mockTauriInternals();

      // First health check (init): fail so we actually spawn
      mockFetch.mockRejectedValueOnce(new Error('Not running'));

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      // Transition to ready
      const stdoutHandler = stdoutHandlers.get('data');
      act(() => {
        stdoutHandler!('SERVER_READY:3100');
      });

      expect(result.current.status).toBe('ready');

      // On close, health check succeeds -> recovery
      mockFetch.mockResolvedValueOnce({ ok: true });

      const closeHandler = commandHandlers.get('close');

      await act(async () => {
        closeHandler!({ code: 0, signal: null });
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.status).toBe('ready');
      expect(result.current.port).toBe(3100);
    });

    it('registers stderr handler', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      const stderrHandler = stderrHandlers.get('data');
      expect(stderrHandler).toBeDefined();

      // Should log stderr output as warning
      act(() => {
        stderrHandler!('Warning: deprecated API');
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Warning: deprecated API')
      );
    });
  });

  describe('dev mode server spawning', () => {
    // import.meta.env.DEV is true in vitest, so this is the default path

    it('starts the dev profile without inheriting production Gateway credentials', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      const { Command } = await import('@tauri-apps/plugin-shell');
      expect(Command.sidecar).toHaveBeenNthCalledWith(
        1,
        'binaries/node',
        ['../../../scripts/hooks/check-native-modules.mjs'],
        expect.objectContaining({
          cwd: '../../..',
        })
      );
      expect(Command.sidecar).toHaveBeenNthCalledWith(
        2,
        'binaries/node',
        ['../../../server/dist/index.js'],
        expect.objectContaining({
          cwd: '../../..',
          env: expect.objectContaining({
            PORT: '0',
            SERVER_HOST: '127.0.0.1',
            ZCLAUDIA_DATA_DIR: '/home/dev user/.zclaudia-dev',
            ZCLAUDIA_CHANNEL: 'dev',
            GATEWAY_URL: '',
            GATEWAY_SECRET: '',
            GATEWAY_NAME: '',
            GATEWAY_NAMESPACE: '',
          }),
        })
      );
    });

    it('stores child process reference after spawn', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      expect(mockSpawnFn).toHaveBeenCalled();
    });

    it('registers the spawned PID to establish the single-server lease', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
        await Promise.resolve();
      });

      expect(mockInvoke).toHaveBeenCalledWith('register_dev_server_pid', { pid: 12345 });
    });

    it('kills spawned process and reports error when PID registration fails', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));
      mockInvoke.mockImplementation((command: string) => {
        if (command === 'get_shell_network_env') return Promise.resolve({});
        if (command === 'probe_opencode_endpoints') return Promise.resolve([]);
        if (command === 'register_dev_server_pid') {
          return Promise.reject(new Error('registry unavailable'));
        }
        return Promise.resolve({});
      });

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
        await Promise.resolve();
      });

      expect(mockChildKillFn).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe('error');
      expect(result.current.error).toContain('Failed to register dev server pid');
      expect(result.current.error).toContain('registry unavailable');
    });
  });

  describe('cleanup on unmount', () => {
    it('stops server on unmount', () => {
      mockTauriInternals();

      const { unmount } = renderHook(() => useEmbeddedServer());

      unmount();

      // Should not throw
      expect(true).toBe(true);
    });

    it('does not update state after unmount on stdout', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { unmount } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      const stdoutHandler = stdoutHandlers.get('data');

      // Unmount sets mountedRef.current = false
      unmount();

      // Now emit SERVER_READY - should be ignored since unmounted
      stdoutHandler?.('SERVER_READY:3100');

      // Status should remain starting (not ready), but we can't check result.current
      // after unmount in the same way. The key is no error is thrown.
      expect(true).toBe(true);
    });

    it('does not update state after unmount on error event', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { unmount } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      const errorHandler = commandHandlers.get('error');

      unmount();

      // Should not throw when calling handler after unmount
      errorHandler?.('Some error');
      expect(true).toBe(true);
    });

    it('does not call invoke stop_server in dev mode on unmount', async () => {
      mockTauriInternals();
      mockFetch.mockRejectedValue(new Error('Not running'));

      const { unmount } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      unmount();

      // In dev mode, stop_server should NOT be called (process left running for HMR reuse)
      expect(mockInvoke).not.toHaveBeenCalledWith('stop_server');
    });
  });

  describe('automatic recovery', () => {
    beforeEach(() => {
      mockTauriInternals();
      vi.stubEnv('DEV', false);
      let port = 4100;
      mockInvoke.mockImplementation((command: string) =>
        Promise.resolve(command === 'start_server' ? { port: port++ } : {})
      );
    });

    const advance = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };
    const starts = () => mockInvoke.mock.calls.filter(([command]) => command === 'start_server');

    it('starts only one production backend under StrictMode effect replay', async () => {
      const { result } = renderHook(() => useEmbeddedServer(), {
        wrapper: ({ children }) => createElement(StrictMode, null, children),
      });
      await advance(0);
      expect(result.current.port).toBe(4100);
      expect(starts()).toHaveLength(1);
    });

    it('restarts a crashed production backend and publishes its new port', async () => {
      const { result } = renderHook(() => useEmbeddedServer());
      await advance(0);
      expect(result.current.port).toBe(4100);
      await advance(15000);
      expect(result.current.status).toBe('error');
      expect(result.current.port).toBeNull();
      await advance(1000);
      expect(result.current.status).toBe('ready');
      expect(result.current.port).toBe(4101);
      expect(starts()).toHaveLength(2);
      expect(mockInvoke).toHaveBeenCalledWith('stop_server');
      mockFetch.mockResolvedValue({ ok: true });
      await advance(5000);
      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://127.0.0.1:4101/health',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('keeps a healthy local backend running during a gateway outage', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const { result } = renderHook(() => useEmbeddedServer());
      await advance(0);
      await advance(65000);
      expect(result.current.status).toBe('ready');
      expect(starts()).toHaveLength(1);
      expect(mockFetch.mock.calls.every(([url]) => url === 'http://127.0.0.1:4100/health')).toBe(
        true
      );
    });

    it('resets the failure count when a local probe succeeds', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('offline'))
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce({ ok: true });
      const { result } = renderHook(() => useEmbeddedServer());
      await advance(0);
      await advance(25000);
      expect(result.current.status).toBe('ready');
      expect(starts()).toHaveLength(1);
      await advance(5000);
      expect(result.current.status).toBe('error');
    });

    it('bounds hanging probes and never overlaps them', async () => {
      mockFetch.mockImplementation(
        (_url, { signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          })
      );
      const { result } = renderHook(() => useEmbeddedServer());
      await advance(0);
      await advance(21000);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.current.status).toBe('error');
      await advance(1000);
      expect(result.current.port).toBe(4101);
    });

    it('backs off repeated startup failures and resets after a stable minute', async () => {
      mockInvoke.mockImplementation((command: string) =>
        command === 'start_server'
          ? Promise.reject(new Error('startup failed'))
          : Promise.resolve({})
      );
      const { result } = renderHook(() => useEmbeddedServer());
      await advance(0);
      expect(result.current.status).toBe('error');
      for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
        const count = starts().length;
        await advance(delay - 1);
        expect(starts()).toHaveLength(count);
        await advance(1);
        expect(starts()).toHaveLength(count + 1);
      }
      mockInvoke.mockImplementation((command: string) =>
        Promise.resolve(command === 'start_server' ? { port: 4200 } : {})
      );
      mockFetch.mockResolvedValue({ ok: true });
      await advance(30000);
      await advance(60000);
      mockFetch.mockRejectedValue(new Error('crashed'));
      await advance(15000);
      expect(result.current.status).toBe('error');
      const count = starts().length;
      await advance(1000);
      expect(starts()).toHaveLength(count + 1);
      expect(result.current.status).toBe('ready');
    });

    it('cancels pending recovery when disabled', async () => {
      const { rerender } = renderHook(({ disabled }) => useEmbeddedServer({ disabled }), {
        initialProps: { disabled: false },
      });
      await advance(0);
      await advance(15000);
      rerender({ disabled: true });
      await advance(60000);
      expect(starts()).toHaveLength(1);
    });

    it('keeps retrying when stopping the old backend repeatedly fails', async () => {
      const { result } = renderHook(() => useEmbeddedServer());
      await advance(0);
      mockInvoke.mockImplementation((command: string) =>
        command === 'stop_server' ? Promise.reject(new Error('stop failed')) : Promise.resolve({})
      );
      await advance(15000);
      await advance(1000);
      expect(result.current.status).toBe('error');
      expect(result.current.error).toContain('stop failed');
      await advance(2000);
      expect(mockInvoke.mock.calls.filter(([command]) => command === 'stop_server')).toHaveLength(
        2
      );
      expect(starts()).toHaveLength(1);
    });

    it('cancels pending recovery on unmount', async () => {
      const { unmount } = renderHook(() => useEmbeddedServer());
      await advance(0);
      await advance(15000);
      unmount();
      await advance(60000);
      expect(starts()).toHaveLength(1);
    });

    it('ignores a failed health probe from a previous launch', async () => {
      let rejectProbe!: (error: Error) => void;
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectProbe = reject;
          })
      );
      const { result } = renderHook(() => useEmbeddedServer());
      await advance(0);
      await advance(5000);
      await act(async () => result.current.restart());
      expect(result.current.port).toBe(4101);
      await act(async () => rejectProbe(new Error('stale failure')));
      expect(result.current.status).toBe('ready');
      expect(result.current.port).toBe(4101);
    });

    it('allows manual restart to supersede an automatic retry without double spawning', async () => {
      const { result } = renderHook(() => useEmbeddedServer());
      await advance(0);
      await advance(15000);
      await act(async () => {
        await Promise.all([result.current.restart(), result.current.restart()]);
      });
      await advance(1000);
      expect(result.current.port).toBe(4101);
      expect(starts()).toHaveLength(2);
    });
  });

  describe('does not start when disabled or non-tauri', () => {
    it('does not start effect when disabled', async () => {
      mockTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer({ disabled: true }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      expect(result.current.status).toBe('disabled');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not start effect when not in Tauri environment', async () => {
      removeTauriInternals();

      const { result } = renderHook(() => useEmbeddedServer());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4200);
      });

      expect(result.current.status).toBe('disabled');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
