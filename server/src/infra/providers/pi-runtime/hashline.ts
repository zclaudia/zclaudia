import { createHash } from 'crypto';

export interface HashlineEntry {
  line: number;
  hash: string;
  text: string;
}

export function hashlineTag(content: string): string {
  return createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
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

export function replaceHashlineLine(content: string, lineHash: string, replacement: string): string | undefined {
  const hasTrailingNewline = content.endsWith('\n');
  const lines = (hasTrailingNewline ? content.slice(0, -1) : content).split('\n');
  const index = lines.findIndex(line => hashlineForLine(line) === lineHash);
  if (index === -1) return undefined;
  lines[index] = replacement;
  return `${lines.join('\n')}${hasTrailingNewline ? '\n' : ''}`;
}
