import { readFile } from 'fs/promises';
import * as path from 'path';
import type { FileChangeNotifier } from './file-change-notifier.js';
import type {
  WriteDiagnosticsProvider,
  WriteLifecycleDiagnostic,
  WriteLifecycleInput,
} from './write-lifecycle.js';

export interface LspTransport {
  notify(method: string, params: unknown): Promise<void> | void;
  onNotification?(method: string, handler: (params: unknown) => void): () => void;
}

export interface LspDiagnosticsAdapterOptions {
  cwd: string;
  transport: LspTransport;
  diagnosticsTimeoutMs?: number;
  languageIdForPath?: (filePath: string) => string;
}

export interface LspDiagnosticsAdapter {
  diagnosticsProvider: WriteDiagnosticsProvider;
  fileChangeNotifier: FileChangeNotifier;
  dispose(): void;
}

type LspDiagnostic = {
  range?: { start?: { line?: number; character?: number } };
  severity?: number;
  message?: string;
  source?: string;
};

type PublishDiagnosticsParams = {
  uri?: string;
  diagnostics?: LspDiagnostic[];
};

const DEFAULT_DIAGNOSTICS_TIMEOUT_MS = 500;

function defaultLanguageIdForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (ext === '.js' || ext === '.jsx') return 'javascript';
  if (ext === '.json') return 'json';
  return 'plaintext';
}

export function filePathToUri(filePath: string): string {
  return new URL(`file://${path.resolve(filePath)}`).href;
}

function uriToPath(uri: string): string {
  return decodeURIComponent(new URL(uri).pathname);
}

function toSeverity(severity: number | undefined): WriteLifecycleDiagnostic['severity'] {
  if (severity === 1) return 'error';
  if (severity === 2) return 'warning';
  return 'info';
}

function toRelativePath(cwd: string, filePath: string): string {
  return path.relative(cwd, path.resolve(filePath)).split(path.sep).join('/');
}

function mapDiagnostics(
  cwd: string,
  uri: string,
  diagnostics: LspDiagnostic[]
): WriteLifecycleDiagnostic[] {
  const filePath = uriToPath(uri);
  const relPath = toRelativePath(cwd, filePath);
  return diagnostics.map(diagnostic => ({
    path: relPath,
    line: (diagnostic.range?.start?.line ?? 0) + 1,
    column: (diagnostic.range?.start?.character ?? 0) + 1,
    severity: toSeverity(diagnostic.severity),
    message: diagnostic.message ?? '',
    ...(diagnostic.source ? { source: diagnostic.source } : {}),
  }));
}

export function createLspDiagnosticsAdapter(
  options: LspDiagnosticsAdapterOptions
): LspDiagnosticsAdapter {
  const diagnosticsByUri = new Map<string, WriteLifecycleDiagnostic[]>();
  const waitersByUri = new Map<string, Array<(diagnostics: WriteLifecycleDiagnostic[]) => void>>();
  const languageIdForPath = options.languageIdForPath ?? defaultLanguageIdForPath;
  const timeoutMs = Math.max(1, options.diagnosticsTimeoutMs ?? DEFAULT_DIAGNOSTICS_TIMEOUT_MS);
  const openedUris = new Set<string>();

  const unsubscribe = options.transport.onNotification?.('textDocument/publishDiagnostics', raw => {
    const params = raw as PublishDiagnosticsParams;
    if (!params.uri) return;
    const diagnostics = mapDiagnostics(options.cwd, params.uri, params.diagnostics ?? []);
    diagnosticsByUri.set(params.uri, diagnostics);
    const waiters = waitersByUri.get(params.uri) ?? [];
    waitersByUri.delete(params.uri);
    for (const resolve of waiters) resolve(diagnostics);
  });

  async function notifyDocumentSaved(
    input: Pick<WriteLifecycleInput, 'absolutePath' | 'path'>
  ): Promise<void> {
    const uri = filePathToUri(input.absolutePath);
    const text = await readFile(input.absolutePath, 'utf8');
    if (!openedUris.has(uri)) {
      openedUris.add(uri);
      await options.transport.notify('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: languageIdForPath(input.absolutePath),
          version: 1,
          text,
        },
      });
    }
    await options.transport.notify('textDocument/didSave', {
      textDocument: { uri },
      text,
    });
  }

  const fileChangeNotifier: FileChangeNotifier = {
    notifyFileChanged: async event => {
      await notifyDocumentSaved(event);
    },
  };

  const diagnosticsProvider: WriteDiagnosticsProvider = async input => {
    const uri = filePathToUri(input.absolutePath);
    const existing = diagnosticsByUri.get(uri);
    if (existing) return existing;
    return await new Promise<WriteLifecycleDiagnostic[]>(resolve => {
      const timer = setTimeout(() => resolve(diagnosticsByUri.get(uri) ?? []), timeoutMs);
      const waiters = waitersByUri.get(uri) ?? [];
      waiters.push(diagnostics => {
        clearTimeout(timer);
        resolve(diagnostics);
      });
      waitersByUri.set(uri, waiters);
    });
  };

  return {
    diagnosticsProvider,
    fileChangeNotifier,
    dispose: () => {
      unsubscribe?.();
      waitersByUri.clear();
      diagnosticsByUri.clear();
      openedUris.clear();
    },
  };
}
