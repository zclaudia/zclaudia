import { createHash } from 'crypto';

export interface HashlineEntry {
  line: number;
  hash: string;
  text: string;
}

export function hashlineTag(content: string): string {
  return createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
}

export function hashlineSnapshotId(path: string, content: string): string {
  return `${path}#${hashlineTag(content)}`;
}

export function parseHashlineOperation(operation: unknown): { type: 'replace'; hash: string } | undefined {
  if (typeof operation !== 'string') return undefined;
  const match = /^replace:([a-f0-9]{12})$/i.exec(operation.trim());
  if (!match) return undefined;
  return { type: 'replace', hash: match[1].toLowerCase() };
}

export function hashlineForLine(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

export function buildHashlineEntries(lines: string[]): HashlineEntry[] {
  return lines.map((text, index) => ({
    line: index + 1,
    hash: hashlineForLine(text),
    text,
  }));
}

export function formatHashlineOutput(path: string, content: string, entries: HashlineEntry[]): string {
  return [
    `[${path}#${hashlineTag(content)}]`,
    ...entries.map(entry => `${entry.hash}|${entry.text}`),
  ].join('\n');
}

function splitLines(content: string): { lines: string[]; hasTrailingNewline: boolean } {
  const hasTrailingNewline = content.endsWith('\n');
  return { lines: (hasTrailingNewline ? content.slice(0, -1) : content).split('\n'), hasTrailingNewline };
}

/** Lines of surrounding context compared on each side when disambiguating. */
const ANCHOR_CONTEXT_LINES = 2;

function contextScore(current: string[], candidate: number, snapshot: string[], anchor: number): number {
  let score = 0;
  for (let offset = -ANCHOR_CONTEXT_LINES; offset <= ANCHOR_CONTEXT_LINES; offset++) {
    if (offset === 0) continue;
    const snapshotLine = snapshot[anchor + offset];
    if (snapshotLine !== undefined && snapshotLine === current[candidate + offset]) score++;
  }
  return score;
}

/**
 * Resolve the index of the anchored line in the current content. When the hash
 * matches several lines (duplicate text), the snapshot — the file as the model
 * last saw it — disambiguates by comparing surrounding context.
 */
export function resolveHashlineTargetIndex(currentLines: string[], lineHash: string, snapshot?: string): number {
  const matches: number[] = [];
  for (let index = 0; index < currentLines.length; index++) {
    if (hashlineForLine(currentLines[index]) === lineHash) matches.push(index);
  }
  if (matches.length === 0) return -1;
  if (matches.length === 1 || !snapshot) return matches[0];

  const snapshotLines = splitLines(snapshot.replace(/\r\n/g, '\n')).lines;
  const anchor = snapshotLines.findIndex(line => hashlineForLine(line) === lineHash);
  if (anchor === -1) return matches[0];

  let best = matches[0];
  let bestScore = -1;
  for (const candidate of matches) {
    const score = contextScore(currentLines, candidate, snapshotLines, anchor);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

export function replaceHashlineLine(
  content: string,
  lineHash: string,
  replacement: string,
  snapshot?: string,
): string | undefined {
  const { lines, hasTrailingNewline } = splitLines(content);
  const index = resolveHashlineTargetIndex(lines, lineHash, snapshot);
  if (index === -1) return undefined;
  lines[index] = replacement;
  return `${lines.join('\n')}${hasTrailingNewline ? '\n' : ''}`;
}
