import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, vi } from 'vitest';
import {
  createLspDiagnosticsAdapter,
  filePathToUri,
  type LspTransport,
} from '../lsp-diagnostics-adapter.js';

describe('lsp diagnostics adapter', () => {
  it('sends LSP document notifications and converts publishDiagnostics into write diagnostics', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-lsp-'));
    const filePath = path.join(dir, 'f.ts');
    writeFileSync(filePath, 'const a: string = 1;\n');
    const handlers = new Map<string, (params: unknown) => void>();
    const notifications: Array<{ method: string; params: any }> = [];
    const transport: LspTransport = {
      notify: vi.fn(async (method, params) => {
        notifications.push({ method, params });
        if (method === 'textDocument/didSave') {
          handlers.get('textDocument/publishDiagnostics')?.({
            uri: filePathToUri(filePath),
            diagnostics: [
              {
                range: { start: { line: 0, character: 6 } },
                severity: 1,
                message: 'Type mismatch',
                source: 'tsserver',
              },
            ],
          });
        }
      }),
      onNotification: (method, handler) => {
        handlers.set(method, handler);
        return () => handlers.delete(method);
      },
    };
    const adapter = createLspDiagnosticsAdapter({ cwd: dir, transport, diagnosticsTimeoutMs: 100 });

    await adapter.fileChangeNotifier.notifyFileChanged({
      path: 'f.ts',
      absolutePath: filePath,
      changeKind: 'modify',
      operation: 'write',
      diff: '',
    });
    const diagnostics = await adapter.diagnosticsProvider({
      operation: 'write',
      type: 'update',
      path: 'f.ts',
      absolutePath: filePath,
      originalContent: 'const a = 1;\n',
      updatedContent: 'const a: string = 1;\n',
      diff: '',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(notifications.map(item => item.method)).toEqual([
      'textDocument/didOpen',
      'textDocument/didSave',
    ]);
    expect(diagnostics).toEqual([
      {
        path: 'f.ts',
        line: 1,
        column: 7,
        severity: 'error',
        message: 'Type mismatch',
        source: 'tsserver',
      },
    ]);
  });

  it('waits for fresh diagnostics after a subsequent save instead of serving stale cache', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-lsp-'));
    const filePath = path.join(dir, 'f.ts');
    writeFileSync(filePath, 'const a = 1;\n');
    const handlers = new Map<string, (params: unknown) => void>();
    const notifications: Array<{ method: string; params: any }> = [];
    const transport: LspTransport = {
      // Publishes diagnostics asynchronously (like a real server) so the
      // provider must wait when the cache predates the latest save.
      notify: vi.fn(async (method, params) => {
        notifications.push({ method, params });
        if (method === 'textDocument/didSave') {
          const text = String((params as { text?: string }).text ?? '');
          setTimeout(() => {
            handlers.get('textDocument/publishDiagnostics')?.({
              uri: filePathToUri(filePath),
              diagnostics: [
                {
                  range: { start: { line: 0, character: 0 } },
                  severity: 1,
                  message: `diag:${text.trim()}`,
                  source: 'tsserver',
                },
              ],
            });
          }, 0);
        }
      }),
      onNotification: (method, handler) => {
        handlers.set(method, handler);
        return () => handlers.delete(method);
      },
    };
    const adapter = createLspDiagnosticsAdapter({ cwd: dir, transport, diagnosticsTimeoutMs: 500 });
    const event = {
      path: 'f.ts',
      absolutePath: filePath,
      changeKind: 'modify' as const,
      operation: 'write' as const,
      diff: '',
    };
    const providerInput = {
      operation: 'write' as const,
      type: 'update' as const,
      path: 'f.ts',
      absolutePath: filePath,
      originalContent: null,
      updatedContent: '',
      diff: '',
    };

    await adapter.fileChangeNotifier.notifyFileChanged(event);
    const first = await adapter.diagnosticsProvider(providerInput);
    expect(first[0]?.message).toBe('diag:const a = 1;');

    writeFileSync(filePath, 'const b = 2;\n');
    await adapter.fileChangeNotifier.notifyFileChanged(event);
    const second = await adapter.diagnosticsProvider(providerInput);

    rmSync(dir, { recursive: true, force: true });
    // Stale-cache regression (P1-12): the second save must not return the
    // first save's diagnostics.
    expect(second[0]?.message).toBe('diag:const b = 2;');
    expect(notifications.map(item => item.method)).toEqual([
      'textDocument/didOpen',
      'textDocument/didSave',
      'textDocument/didChange',
      'textDocument/didSave',
    ]);
    // Document versions increment per save.
    expect(notifications[0].params.textDocument.version).toBe(1);
    expect(notifications[2].params.textDocument.version).toBe(2);
    expect(notifications[2].params.contentChanges).toEqual([{ text: 'const b = 2;\n' }]);
  });

  it('escapes special characters in file URIs and round-trips a#b.ts', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-lsp-'));
    const filePath = path.join(dir, 'a#b.ts');
    writeFileSync(filePath, 'const a: string = 1;\n');
    expect(filePathToUri(filePath)).toContain('a%23b.ts');
    expect(filePathToUri(path.join(dir, 'a b%c#d?.ts'))).toContain('a%20b%25c%23d%3F.ts');

    const handlers = new Map<string, (params: unknown) => void>();
    const notifications: Array<{ method: string; params: any }> = [];
    const transport: LspTransport = {
      notify: vi.fn(async (method, params) => {
        notifications.push({ method, params });
        if (method === 'textDocument/didSave') {
          handlers.get('textDocument/publishDiagnostics')?.({
            uri: filePathToUri(filePath),
            diagnostics: [
              {
                range: { start: { line: 0, character: 6 } },
                severity: 1,
                message: 'Type mismatch',
                source: 'tsserver',
              },
            ],
          });
        }
      }),
      onNotification: (method, handler) => {
        handlers.set(method, handler);
        return () => handlers.delete(method);
      },
    };
    const adapter = createLspDiagnosticsAdapter({ cwd: dir, transport, diagnosticsTimeoutMs: 100 });

    await adapter.fileChangeNotifier.notifyFileChanged({
      path: 'a#b.ts',
      absolutePath: filePath,
      changeKind: 'modify',
      operation: 'write',
      diff: '',
    });
    const diagnostics = await adapter.diagnosticsProvider({
      operation: 'write',
      type: 'update',
      path: 'a#b.ts',
      absolutePath: filePath,
      originalContent: null,
      updatedContent: 'const a: string = 1;\n',
      diff: '',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(notifications[0].params.textDocument.uri).toBe(filePathToUri(filePath));
    expect(diagnostics).toEqual([
      {
        path: 'a#b.ts',
        line: 1,
        column: 7,
        severity: 'error',
        message: 'Type mismatch',
        source: 'tsserver',
      },
    ]);
  });

  it('sends didClose for every opened document on dispose', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-lsp-'));
    const filePath = path.join(dir, 'f.ts');
    writeFileSync(filePath, 'const a = 1;\n');
    const transport: LspTransport = {
      notify: vi.fn(async () => {}),
      onNotification: () => () => {},
    };
    const adapter = createLspDiagnosticsAdapter({ cwd: dir, transport, diagnosticsTimeoutMs: 100 });

    await adapter.fileChangeNotifier.notifyFileChanged({
      path: 'f.ts',
      absolutePath: filePath,
      changeKind: 'modify',
      operation: 'write',
      diff: '',
    });
    adapter.dispose();

    rmSync(dir, { recursive: true, force: true });
    expect(transport.notify).toHaveBeenCalledWith('textDocument/didClose', {
      textDocument: { uri: filePathToUri(filePath) },
    });
    // A second dispose must not re-send didClose.
    adapter.dispose();
    expect(
      (transport.notify as ReturnType<typeof vi.fn>).mock.calls.filter(
        call => call[0] === 'textDocument/didClose'
      )
    ).toHaveLength(1);
  });
});
