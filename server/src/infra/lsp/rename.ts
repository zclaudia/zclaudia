/**
 * Rename support: turn a server's WorkspaceEdit into per-file text edits.
 *
 * The manager only computes; applying is the caller's job (the RenameSymbol
 * tool writes through the edit pipeline). Only text edits are accepted —
 * file operations (create / rename / delete) are refused as a whole, so a
 * rename never half-happens.
 */
import { fileURLToPath } from 'url';
import { LanguageServerError, type LspTextEdit } from '../providers/language-server-port.js';

interface RawPosition {
  line?: number;
  character?: number;
}

interface RawTextEdit {
  range?: { start?: RawPosition; end?: RawPosition };
  newText?: string;
}

interface RawWorkspaceEdit {
  changes?: Record<string, RawTextEdit[]>;
  documentChanges?: Array<{
    kind?: string;
    textDocument?: { uri?: string };
    edits?: RawTextEdit[];
  } | null>;
}

function toTextEdit(raw: RawTextEdit): LspTextEdit {
  const start = raw.range?.start;
  const end = raw.range?.end;
  if (
    typeof start?.line !== 'number' ||
    typeof start.character !== 'number' ||
    typeof end?.line !== 'number' ||
    typeof end.character !== 'number' ||
    typeof raw.newText !== 'string'
  ) {
    throw new LanguageServerError(
      'request_failed',
      'The language server returned a malformed edit'
    );
  }
  return {
    startLine: start.line,
    startCharacter: start.character,
    endLine: end.line,
    endCharacter: end.character,
    newText: raw.newText,
  };
}

/** Absolute file path → its edits, in the order the server listed them. */
export function workspaceEditToFileEdits(raw: unknown): Map<string, LspTextEdit[]> {
  const edit = (raw ?? {}) as RawWorkspaceEdit;
  const byFile = new Map<string, LspTextEdit[]>();
  const add = (uri: string | undefined, edits: RawTextEdit[] | undefined) => {
    if (!uri) return;
    let file: string;
    try {
      file = fileURLToPath(uri);
    } catch {
      throw new LanguageServerError('unsupported_edit', `Cannot edit a non-file document: ${uri}`);
    }
    const list = byFile.get(file) ?? [];
    list.push(...(edits ?? []).map(toTextEdit));
    byFile.set(file, list);
  };

  // `documentChanges` wins over `changes` when a server sends both (LSP spec).
  if (Array.isArray(edit.documentChanges)) {
    for (const change of edit.documentChanges) {
      if (!change) continue;
      if (change.kind) {
        throw new LanguageServerError(
          'unsupported_edit',
          `The rename also needs a file operation (${change.kind}), which is not supported; rename the file yourself`
        );
      }
      add(change.textDocument?.uri, change.edits);
    }
  } else if (edit.changes && typeof edit.changes === 'object') {
    for (const [uri, edits] of Object.entries(edit.changes)) add(uri, edits);
  }
  return byFile;
}

/** The current name from a prepareRename answer, when it says. */
export function prepareRenamePlaceholder(raw: unknown): string | undefined {
  if (raw && typeof raw === 'object' && 'placeholder' in raw) {
    const placeholder = (raw as { placeholder?: unknown }).placeholder;
    return typeof placeholder === 'string' ? placeholder : undefined;
  }
  return undefined;
}
