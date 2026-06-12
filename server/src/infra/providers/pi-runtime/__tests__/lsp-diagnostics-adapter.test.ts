import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, vi } from 'vitest';
import { createLspDiagnosticsAdapter, filePathToUri, type LspTransport } from '../lsp-diagnostics-adapter.js';

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
            diagnostics: [{
              range: { start: { line: 0, character: 6 } },
              severity: 1,
              message: 'Type mismatch',
              source: 'tsserver',
            }],
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
      { path: 'f.ts', line: 1, column: 7, severity: 'error', message: 'Type mismatch', source: 'tsserver' },
    ]);
  });
});
