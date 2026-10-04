/**
 * Pure mapping from raw LSP responses to the port's result types: 0-based
 * ranges become 1-based positions, URIs become workspace-relative paths (or
 * absolute ones flagged `external`), and every location gets a one-line
 * preview so the model rarely needs a follow-up Read — and can still see
 * results Read is not allowed to open.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { LspIncomingCall, LspLocation, LspSymbol } from '../providers/language-server-port.js';

const PREVIEW_MAX_CHARS = 200;

// LSP SymbolKind, 1-based.
const SYMBOL_KINDS = [
  'file',
  'module',
  'namespace',
  'package',
  'class',
  'method',
  'property',
  'field',
  'constructor',
  'enum',
  'interface',
  'function',
  'variable',
  'constant',
  'string',
  'number',
  'boolean',
  'array',
  'object',
  'key',
  'null',
  'enumMember',
  'struct',
  'event',
  'operator',
  'typeParameter',
];

interface RawPosition {
  line: number;
  character: number;
}
interface RawRange {
  start: RawPosition;
  end: RawPosition;
}
interface RawLocation {
  uri: string;
  range: RawRange;
}
interface RawLocationLink {
  targetUri: string;
  targetRange: RawRange;
  targetSelectionRange?: RawRange;
}
interface RawDocumentSymbol {
  name: string;
  kind: number;
  detail?: string;
  range: RawRange;
  selectionRange: RawRange;
  children?: RawDocumentSymbol[];
}
interface RawSymbolInformation {
  name: string;
  kind: number;
  location: { uri: string; range?: RawRange };
  containerName?: string;
}
interface RawCallHierarchyItem {
  name: string;
  kind: number;
  uri: string;
  range: RawRange;
  selectionRange: RawRange;
  detail?: string;
}
interface RawIncomingCall {
  from: RawCallHierarchyItem;
  fromRanges: RawRange[];
}

export function symbolKindName(kind: number): string {
  return SYMBOL_KINDS[kind - 1] ?? 'unknown';
}

/** Absolute path for a file URI; null for non-file schemes. */
function uriToPath(uri: string): string | null {
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

export function toLocation(root: string, uri: string, range: RawRange | undefined): LspLocation {
  const absolute = uriToPath(uri);
  const start = range?.start ?? { line: 0, character: 0 };
  const position = {
    line: start.line + 1,
    character: start.character + 1,
    ...(range ? { endLine: range.end.line + 1, endCharacter: range.end.character + 1 } : {}),
  };
  if (!absolute) return { file: uri, external: true, ...position };
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { file: absolute, external: true, ...position };
  }
  return { file: relative.split(path.sep).join('/'), ...position };
}

/** definition: Location | Location[] | LocationLink[] | null. */
export function definitionLocations(root: string, raw: unknown): LspLocation[] {
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  return items.map(item =>
    'targetUri' in (item as object)
      ? toLocation(
          root,
          (item as RawLocationLink).targetUri,
          (item as RawLocationLink).targetSelectionRange ?? (item as RawLocationLink).targetRange
        )
      : toLocation(root, (item as RawLocation).uri, (item as RawLocation).range)
  );
}

export function referenceLocations(root: string, raw: unknown): LspLocation[] {
  return Array.isArray(raw)
    ? (raw as RawLocation[]).map(item => toLocation(root, item.uri, item.range))
    : [];
}

type MarkedString = string | { language?: string; value: string };

/** Hover contents (MarkedString | MarkedString[] | MarkupContent) as markdown. */
export function hoverText(raw: unknown): string | null {
  const contents = (raw as { contents?: unknown } | null)?.contents;
  if (!contents) return null;
  const parts = (Array.isArray(contents) ? contents : [contents]) as Array<
    MarkedString | { kind: string; value: string }
  >;
  const text = parts
    .map(part => {
      if (typeof part === 'string') return part;
      if ('kind' in part) return part.value;
      return part.language ? `\`\`\`${part.language}\n${part.value}\n\`\`\`` : part.value;
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
  return text || null;
}

function fromDocumentSymbol(root: string, uri: string, symbol: RawDocumentSymbol): LspSymbol {
  return {
    name: symbol.name,
    kind: symbolKindName(symbol.kind),
    location: toLocation(root, uri, symbol.selectionRange),
    ...(symbol.children?.length
      ? { children: symbol.children.map(child => fromDocumentSymbol(root, uri, child)) }
      : {}),
  };
}

/** documentSymbol / workspace/symbol: DocumentSymbol[] | SymbolInformation[] | WorkspaceSymbol[]. */
export function symbolList(root: string, uri: string | null, raw: unknown): LspSymbol[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => {
    if ('location' in item) {
      const info = item as RawSymbolInformation;
      return {
        name: info.name,
        kind: symbolKindName(info.kind),
        location: toLocation(root, info.location.uri, info.location.range),
        ...(info.containerName ? { containerName: info.containerName } : {}),
      };
    }
    return fromDocumentSymbol(root, uri ?? '', item as RawDocumentSymbol);
  });
}

/** Keep at most `budget` symbols, depth first; reports whether any were cut. */
export function pruneSymbols(
  symbols: LspSymbol[],
  budget: number
): { symbols: LspSymbol[]; truncated: boolean } {
  let left = budget;
  let truncated = false;
  const walk = (list: LspSymbol[]): LspSymbol[] => {
    const kept: LspSymbol[] = [];
    for (const symbol of list) {
      if (left <= 0) {
        truncated = true;
        break;
      }
      left -= 1;
      const { children, ...rest } = symbol;
      const keptChildren = children ? walk(children) : undefined;
      kept.push(keptChildren?.length ? { ...rest, children: keptChildren } : rest);
    }
    return kept;
  };
  return { symbols: walk(symbols), truncated };
}

export function incomingCalls(root: string, raw: unknown): LspIncomingCall[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawIncomingCall[]).map(call => ({
    caller: {
      name: call.from.name,
      kind: symbolKindName(call.from.kind),
      location: toLocation(root, call.from.uri, call.from.selectionRange),
      ...(call.from.detail ? { containerName: call.from.detail } : {}),
    },
    callSites: call.fromRanges.map(range => toLocation(root, call.from.uri, range)),
  }));
}

/** Attach the source line at each location, reading every file once. */
export async function attachPreviews(root: string, locations: LspLocation[]): Promise<void> {
  const files = new Map<string, Promise<string[] | null>>();
  const linesOf = (file: string) => {
    let pending = files.get(file);
    if (!pending) {
      const absolute = path.isAbsolute(file) ? file : path.join(root, file);
      pending = readFile(absolute, 'utf8').then(
        text => text.split(/\r?\n/),
        () => null
      );
      files.set(file, pending);
    }
    return pending;
  };
  await Promise.all(
    locations.map(async location => {
      const lines = await linesOf(location.file);
      const line = lines?.[location.line - 1];
      if (line === undefined) return;
      const trimmed = line.trim();
      location.preview =
        trimmed.length > PREVIEW_MAX_CHARS ? `${trimmed.slice(0, PREVIEW_MAX_CHARS)}…` : trimmed;
    })
  );
}

/** Every location inside a symbol tree (for preview attachment). */
export function symbolLocations(symbols: LspSymbol[]): LspLocation[] {
  return symbols.flatMap(symbol => [
    symbol.location,
    ...(symbol.children ? symbolLocations(symbol.children) : []),
  ]);
}
