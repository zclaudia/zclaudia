import { parse } from 'parse5';
import path from 'node:path';

/**
 * Resource reference graph for design snapshots (P1.6 §6.2).
 *
 * `collectHtmlResourceRefs` parses an HTML document and collects local
 * resource references; `collectCssResourceRefs` extracts url()/`@import`
 * targets from a stylesheet. Relative references are normalized against the
 * directory of the referencing file (mirroring the desktop preview's
 * normalization). Absolute paths, protocol URLs and `..`-escapes above the
 * workspace root are recorded in `skipped` with a reason instead of being
 * treated as resources.
 */

export type ResourceRefKind = 'css' | 'image' | 'font' | 'other';

export interface ResourceRef {
  /** Workspace-relative, normalized path. */
  path: string;
  kind: ResourceRefKind;
}

export interface SkippedResource {
  /** The raw reference text as it appeared in the source. */
  raw: string;
  reason: string;
}

export interface ResourceRefResult {
  refs: ResourceRef[];
  skipped: SkippedResource[];
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif']);
const FONT_EXTENSIONS = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot']);

export function kindForPath(refPath: string): ResourceRefKind {
  const ext = path.posix.extname(refPath).toLowerCase();
  if (ext === '.css') return 'css';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (FONT_EXTENSIONS.has(ext)) return 'font';
  return 'other';
}

/** Minimal structural view of the parse5 default tree we walk. */
interface P5Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: P5Node[];
  content?: P5Node;
}

function attr(element: P5Node, name: string): string | null {
  const found = element.attrs?.find(candidate => candidate.name === name);
  return found ? found.value : null;
}

function walk(node: P5Node, visit: (element: P5Node) => void): void {
  for (const child of node.childNodes ?? []) {
    if (child.nodeName.startsWith('#')) continue;
    visit(child);
    walk(child, visit);
    // <template> content lives outside the document tree.
    if (child.content) walk(child.content, visit);
  }
}

/**
 * Normalize a raw reference against the directory of the referencing file.
 * Returns the workspace-relative path, or a skip reason.
 */
function resolveReference(raw: string, fromDir: string): { path: string } | { skip: string } {
  const trimmed = raw.trim();
  const withoutQuery = trimmed.split(/[?#]/, 1)[0];
  if (!withoutQuery) return { skip: 'empty-reference' };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(withoutQuery)) return { skip: 'external-url' };
  if (withoutQuery.startsWith('//')) return { skip: 'external-url' };
  if (withoutQuery.startsWith('/')) return { skip: 'absolute-path' };
  // Mirror the preview's normalization: backslashes become separators, empty
  // and "." segments drop, ".." pops — but a pop beyond the workspace root is
  // reported as an escape instead of silently collapsing.
  const parts: string[] = [];
  for (const part of fromDir.split('/')) {
    if (part && part !== '.') parts.push(part);
  }
  for (const part of withoutQuery.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return { skip: 'escapes-workspace' };
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  if (!parts.length) return { skip: 'empty-reference' };
  return { path: parts.join('/') };
}

function collect(candidates: Array<{ raw: string; kind?: ResourceRefKind }>, fromDir: string, result: ResourceRefResult): void {
  const byPath = new Map<string, ResourceRef>();
  const skippedRaw = new Set<string>();
  // Refs collected earlier in the same document win; so do skip reasons.
  const priorRefs = new Set(result.refs.map(ref => ref.path));
  const priorSkipped = new Set(result.skipped.map(entry => entry.raw));
  for (const candidate of candidates) {
    const resolved = resolveReference(candidate.raw, fromDir);
    if ('skip' in resolved) {
      if (!priorSkipped.has(candidate.raw) && !skippedRaw.has(candidate.raw)) {
        skippedRaw.add(candidate.raw);
        result.skipped.push({ raw: candidate.raw, reason: resolved.skip });
      }
      continue;
    }
    if (priorRefs.has(resolved.path)) continue;
    if (byPath.has(resolved.path)) continue;
    const ref: ResourceRef = {
      path: resolved.path,
      kind: candidate.kind ?? kindForPath(resolved.path),
    };
    byPath.set(resolved.path, ref);
    result.refs.push(ref);
  }
}

/** Extract url() targets (and string-form @import) from CSS text. */
function cssRefs(css: string, cssPath: string, result: ResourceRefResult): void {
  const fromDir = path.posix.dirname(cssPath);
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const candidates: Array<{ raw: string }> = [];
  const urlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*?))\s*\)/gi;
  for (const match of withoutComments.matchAll(urlPattern)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (raw) candidates.push({ raw });
  }
  // String-form @import: @import "extra.css"; (url()-form is covered above).
  const importPattern = /@import\s+(?!url\()(["'])([^"']+)\1/gi;
  for (const match of withoutComments.matchAll(importPattern)) {
    const raw = (match[2] ?? '').trim();
    if (raw) candidates.push({ raw });
  }
  collect(candidates, fromDir, result);
}

export function collectHtmlResourceRefs(html: string, entryPath: string): ResourceRefResult {
  const result: ResourceRefResult = { refs: [], skipped: [] };
  const document = parse(html) as unknown as P5Node;
  const fromDir = path.posix.dirname(entryPath);
  const candidates: Array<{ raw: string; kind?: ResourceRefKind }> = [];
  walk(document, element => {
    if (element.tagName === 'link') {
      const rel = (attr(element, 'rel') ?? '').toLowerCase().split(/\s+/);
      const href = attr(element, 'href');
      if (rel.includes('stylesheet') && href !== null) candidates.push({ raw: href, kind: 'css' });
      return;
    }
    if (element.tagName === 'img') {
      const src = attr(element, 'src');
      if (src !== null) candidates.push({ raw: src });
      const srcset = attr(element, 'srcset');
      if (srcset !== null) {
        for (const candidate of parseSrcset(srcset)) candidates.push({ raw: candidate });
      }
      return;
    }
    if (element.tagName === 'source') {
      const src = attr(element, 'src');
      if (src !== null) candidates.push({ raw: src });
      const srcset = attr(element, 'srcset');
      if (srcset !== null) {
        for (const candidate of parseSrcset(srcset)) candidates.push({ raw: candidate });
      }
      return;
    }
    if (element.tagName === 'style') {
      const css = textContent(element);
      if (css) cssRefs(css, entryPath, result);
      return;
    }
    const style = attr(element, 'style');
    if (style !== null) cssRefs(style, entryPath, result);
  });
  collect(candidates, fromDir, result);
  return result;
}

export function collectCssResourceRefs(css: string, cssPath: string): ResourceRefResult {
  const result: ResourceRefResult = { refs: [], skipped: [] };
  cssRefs(css, cssPath, result);
  return result;
}

function textContent(node: P5Node): string {
  let text = '';
  for (const child of node.childNodes ?? []) {
    if (child.nodeName === '#text') text += child.value ?? '';
    else if (child.childNodes) text += textContent(child);
  }
  return text;
}

function parseSrcset(value: string): string[] {
  const urls: string[] = [];
  for (const candidate of value.split(',')) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const url = trimmed.split(/\s+/)[0];
    if (url) urls.push(url);
  }
  return urls;
}
