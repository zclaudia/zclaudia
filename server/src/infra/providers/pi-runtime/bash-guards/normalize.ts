/**
 * Command normalization for guard matching ONLY (never executed):
 *   - shell word splitting (with quote-concatenation concatenation semantics),
 *   - obfuscating-quote stripping,
 *   - split short-flag merging + `--` collapsing,
 *   - home-path normalization (`$HOME` / absolute home → `~`).
 *
 * See bash-guards.ts header for the honest scope: normalization closes the
 * cheap, verified bypasses; it is NOT a security boundary.
 */

import * as os from 'os';
import { GENERATED_OR_TEMP_PATH, SOURCE_OR_CONFIG_PATH } from './patterns.js';

/** Strip a single layer of surrounding matching quotes. */
export function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

export function isSafeExternalSink(pathText: string): boolean {
  const value = unquote(pathText);
  return (
    value === '/dev/null' ||
    value.startsWith('/tmp/') ||
    value.startsWith('/var/tmp/') ||
    value.startsWith('$TMPDIR/') ||
    value.startsWith('${TMPDIR}/')
  );
}

export function isWorkspaceSourceLikePath(pathText: string): boolean {
  const value = unquote(pathText).replace(/^\.\//, '');
  if (!value || value.startsWith('-')) return false;
  if (isSafeExternalSink(value)) return false;
  if (/^[A-Z_][A-Z0-9_]*(?:\/|$)/.test(value)) return false;
  if (GENERATED_OR_TEMP_PATH.test(value)) return false;
  return SOURCE_OR_CONFIG_PATH.test(value);
}

/**
 * Split a command string into shell words. Adjacent quoted/unquoted segments
 * of one word are concatenated the way the shell does (`package".json"` →
 * `package.json`, `r"m"` → `rm`), so quote-concatenation obfuscation does not
 * hide operands from the guards.
 */
export function shellWords(text: string): string[] {
  const words: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|([^\s;&|<>"']+)/g;
  let match: RegExpExecArray | null;
  let current = '';
  let hasCurrent = false;
  let prevEnd = -1;
  while ((match = pattern.exec(text))) {
    const part = match[1] ?? match[2] ?? match[3] ?? '';
    if (hasCurrent && match.index === prevEnd) {
      current += part;
    } else {
      if (hasCurrent) words.push(current);
      current = part;
      hasCurrent = true;
    }
    prevEnd = match.index + match[0].length;
  }
  if (hasCurrent) words.push(current);
  return words;
}

/**
 * Strip quote characters that obfuscate guard matching (`r"m"` → `rm`,
 * `package".json"` → `package.json`). Conservative rules — quotes are removed
 * from a single-whitespace-free word only when:
 *   - the word MIXES quoted and unquoted segments (true concatenation), or
 *   - the word sits at a command position (after start / `;` / `|` / `&`), or
 *   - the unquoted result looks like a flag (`"-rf"` → `-rf`).
 * Quotes wrapping multi-word strings or ordinary quoted arguments are kept:
 * `grep -r "mkfs" docs/` and `echo 'shutdown the queue'` must stay benign.
 */
export function stripObfuscatingQuotes(command: string): string {
  interface Word {
    raw: string;
    mixed: boolean;
    commandPosition: boolean;
  }
  const words: Word[] = [];
  let current = '';
  let hasCurrent = false;
  let hasQuoted = false;
  let hasBare = false;
  let quote: '"' | "'" | undefined;
  let nextIsCommandPosition = true;
  let wordIsCommandPosition = true;
  const push = () => {
    if (hasCurrent) {
      words.push({
        raw: current,
        mixed: hasQuoted && hasBare,
        commandPosition: wordIsCommandPosition,
      });
    }
    current = '';
    hasCurrent = false;
    hasQuoted = false;
    hasBare = false;
  };
  for (const ch of command) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (!hasCurrent) wordIsCommandPosition = nextIsCommandPosition;
      quote = ch;
      current += ch;
      hasCurrent = true;
      hasQuoted = true;
      continue;
    }
    if (/\s/.test(ch)) {
      push();
      continue;
    }
    if (ch === ';' || ch === '&' || ch === '|') {
      push();
      nextIsCommandPosition = true;
      continue; // separators are dropped; raw matching still covers them
    }
    if (!hasCurrent) wordIsCommandPosition = nextIsCommandPosition;
    current += ch;
    hasCurrent = true;
    hasBare = true;
    nextIsCommandPosition = false;
  }
  push();
  return words
    .map(word => {
      const stripped = word.raw.replace(/["']/g, '');
      if (/\s/.test(stripped)) return word.raw; // multi-word string argument
      if (word.mixed || word.commandPosition || /^-[a-zA-Z0-9]/.test(stripped)) return stripped;
      return word.raw;
    })
    .join(' ');
}

const SHORT_FLAG_TOKEN = /^-[a-zA-Z]+$/;

/**
 * Canonicalize a command for guard matching ONLY (never executed):
 * - strips obfuscating quotes (`r"m" -rf /` → `rm -rf /`);
 * - merges adjacent split short-flag tokens (`rm -r -f /etc` → `rm -rf /etc`),
 *   since shells treat `-r -f` and `-rf` identically for the flagged commands;
 * - drops standalone `--` separators (`rm -rf -- /` → `rm -rf /`).
 * Over-normalizing is safe here: a false positive costs one approval prompt.
 */
export function normalizeBashCommandForMatch(command: string): string {
  const tokens = stripObfuscatingQuotes(command).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const token of tokens) {
    if (token === '--') continue;
    const prev = out[out.length - 1];
    if (prev !== undefined && SHORT_FLAG_TOKEN.test(prev) && SHORT_FLAG_TOKEN.test(token)) {
      out[out.length - 1] = prev + token.slice(1);
      continue;
    }
    out.push(token);
  }
  return out.join(' ');
}

/**
 * Normalize a matched home path token to the canonical `~/...` form:
 * unquote, drop backslash escapes, rewrite `$HOME` / `${HOME}` / the absolute
 * home directory to `~`. os.homedir() (not process.env.HOME): one consistent
 * home source across the guards and bash-tool.ts. On POSIX os.homedir()
 * honors $HOME, so tests that override HOME still work.
 */
export function normalizeHomePath(value: string): string {
  const unquoted = unquote(value)
    .replace(/^\\(["'])/, '$1')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/^\$HOME(?=\/)/, '~')
    .replace(/^\$\{HOME\}(?=\/)/, '~');
  const home = os.homedir().replace(/\/+$/, '');
  if (home && (unquoted === home || unquoted.startsWith(`${home}/`))) {
    return `~${unquoted.slice(home.length)}`;
  }
  return unquoted;
}

/** Lower-cased trailing path component, used as the effective executable name. */
export function executableName(value: string): string {
  return value.split('/').pop()?.toLowerCase() ?? value.toLowerCase();
}

export function isWorkspaceRelativeOperand(value: string | undefined): boolean {
  if (!value) return true;
  return !/^(?:\/|~|[A-Za-z]:[\\/]|\.{2}(?:\/|$))/.test(value);
}

export function hasShellControlSyntax(command: string): boolean {
  return /[;&|<>`]/.test(command) || /\$\(/.test(command);
}

export function optionValue(words: string[], names: string[]): string | undefined {
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (names.includes(word)) return words[i + 1];
    const prefix = names.find(name => word.startsWith(`${name}=`));
    if (prefix) return word.slice(prefix.length + 1);
  }
  return undefined;
}

export function nonOptionOperands(words: string[], skipOptionArgs: Set<string> = new Set()): string[] {
  const operands: string[] = [];
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    if (word === '--') {
      operands.push(...words.slice(i + 1));
      break;
    }
    if (skipOptionArgs.has(word)) {
      i++;
      continue;
    }
    if (Array.from(skipOptionArgs).some(option => word.startsWith(`${option}=`))) continue;
    if (word.startsWith('-')) continue;
    operands.push(word);
  }
  return operands;
}
