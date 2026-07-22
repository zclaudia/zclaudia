/**
 * Critical Bash command patterns — a second gate alongside the sandbox.
 *
 * HONEST SCOPE: this guard is a UX / approval layer, NOT a security boundary.
 * Pattern matching can always be evaded by sufficiently creative obfuscation;
 * the actual isolation comes from the sandbox (denyRead lists, network
 * allow-list) and from the human approval prompt that critical matches route
 * through. Matching is deliberately biased toward false positives (which only
 * cost an approval prompt) over false negatives (which would run unattended).
 * Before matching, commands go through a normalization layer (quote
 * stripping, split-flag merging, `--` collapsing — see
 * normalizeBashCommandForMatch) that closes the cheap, verified bypasses.
 *
 * New patterns should target shapes that are virtually never legitimate in
 * automation, keeping the approval-prompt cost of a false positive low.
 */

import * as os from 'os';

/** Permission-callback tool name for critical-command escalation. */
export const CRITICAL_BASH_APPROVAL_TOOL = 'CriticalBashCommand';

export interface CriticalBashMatch {
  reason: string;
}

export type BashFileBypassKind = 'file_read' | 'file_write';

export interface BashFileBypassMatch {
  kind: BashFileBypassKind;
  reason: string;
  suggestedTool: 'Read' | 'Edit' | 'Write';
  /** The workspace path the command touches, when it could be extracted. */
  target?: string;
}

export interface BashToolRoutingSuggestion {
  reason: string;
  suggestedTool: 'LS' | 'Glob' | 'Grep';
  suggestedInput: Record<string, unknown>;
}

export interface BashSensitivePathMatch {
  path: string;
  reason: string;
}

const CRITICAL_BASH_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  // Recursive destruction.
  { pattern: /\brm\s+-[a-z]*[rRfF][a-z]*\s+\//i, reason: 'recursive delete of a root-level path' },
  { pattern: /\bsudo\s+rm\b/i, reason: 'privileged file deletion (sudo rm)' },
  {
    pattern: /\bchmod\s+-R\s+[0-7]+\s+\//i,
    reason: 'recursive permission change on a root-level path',
  },
  {
    pattern: /\bchmod\s+-R\s+[ugoa+\-=rwxXst,]+\s+\//,
    reason: 'recursive permission change on a root-level path',
  },
  {
    pattern: /\bchown\s+-R\s+\S+\s+\//i,
    reason: 'recursive ownership change on a root-level path',
  },

  // Fork bomb (a few common spacings).
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:/i, reason: 'fork bomb' },

  // Disk / filesystem destruction.
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: 'write to a raw disk device' },
  // Anchored to command position so `grep "mkfs" docs/` doesn't false-positive.
  { pattern: /(?:^|[\s;&|(])mkfs(?:\.\w+)?\b/i, reason: 'filesystem format (mkfs)' },
  { pattern: /\bdd\s+if=.+of=\/dev\//i, reason: 'dd to a device' },
  { pattern: /\bshred\s+\/dev\//i, reason: 'shred a device' },
  { pattern: /\bcryptsetup\b/i, reason: 'disk encryption manipulation (cryptsetup)' },

  // System-config destruction.
  { pattern: />\s*\/etc\/(?:passwd|shadow|sudoers)\b/i, reason: 'overwrite of a system auth file' },
  {
    pattern: /\btee\s+(?:-a\s+)?\/etc\/(?:passwd|shadow|sudoers)\b/i,
    reason: 'overwrite of a system auth file',
  },

  // Remote-fetch-then-execute (curl/wget piped to a shell or process-subbed).
  {
    pattern: /\b(?:curl|wget|fetch)\b[^|]*\|\s*(?:bash|sh|zsh|fish)\b/i,
    reason: 'remote fetch piped into a shell (fetch-then-execute)',
  },
  // Process-sub variants — `bash <(curl …)`, `source <(curl …)`, `. <(curl …)`. `.` and `source` are
  // anchored to a command boundary so `find . -name` and similar don't false-positive.
  {
    pattern: /(?:^|[\s;&|(])(?:bash|sh|zsh|source|\.)\s+<\(\s*(?:curl|wget|fetch)\b/i,
    reason: 'remote fetch executed via process substitution (fetch-then-execute)',
  },
  // `eval "$(curl …)"` / `eval $(curl …)` / `eval \`curl …\``.
  {
    pattern: /\beval\s+["'`]?\$\(\s*(?:curl|wget|fetch)\b|\beval\s+`\s*(?:curl|wget|fetch)\b/i,
    reason: 'remote fetch evaluated as code (fetch-then-execute)',
  },

  // Process/host control.
  { pattern: /\bkill\s+(?:-\S+\s+)?1\b/, reason: 'kill of PID 1' },
  // Must sit at command position so `npm run reboot-tests` or `echo 'shutdown the queue'`
  // don't false-positive.
  {
    pattern: /(?:^|[\s;&|(])(?:shutdown|poweroff|reboot|halt)(?:\s|$|[;|&])/i,
    reason: 'host shutdown or reboot',
  },
  { pattern: /(?:^|[\s;&|(])init\s+0\b/i, reason: 'host shutdown (init 0)' },

  // Network-shell exfil. The flag may glue directly to its payload
  // (`nc -c/bin/sh`) as well as sit before a space (`nc -e /bin/sh`).
  {
    pattern: /\bnc\b[^|;]*\s-[a-zA-Z]*[ec][a-zA-Z]*(?:[\s/=]|$)/i,
    reason: 'netcat with command execution (reverse shell)',
  },

  // Obfuscated execution: decode-then-run (`echo cm0gLXJmIC8K | base64 -d | bash`).
  {
    pattern: /\bbase64\s+(?:-[a-zA-Z]*[dD][a-zA-Z]*|--decode)\b[^|]*\|\s*(?:bash|sh|zsh|fish)\b/i,
    reason: 'base64-decoded payload piped into a shell (obfuscated execution)',
  },
];

const SOURCE_OR_CONFIG_PATH =
  /(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|vite\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|AGENTS\.md|README\.md|[.\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|yaml|yml|toml|css|scss|html|rs|go|py|java|kt|c|cc|cpp|h|hpp|sh|sql|txt))$/i;
const GENERATED_OR_TEMP_PATH =
  /(?:^|\/)(?:node_modules|dist|build|coverage|target|\.next|\.turbo|\.cache|tmp|temp|logs?)(?:\/|$)/i;

const SENSITIVE_HOME_PATHS: ReadonlyArray<RegExp> = [
  /^~\/\.ssh(?:\/|$)/,
  /^~\/\.gnupg(?:\/|$)/,
  /^~\/\.aws\/credentials$/,
  /^~\/\.config\/gcloud(?:\/|$)/,
  /^~\/\.azure(?:\/|$)/,
  /^~\/\.docker\/config\.json$/,
  /^~\/\.kube\/config$/,
  /^~\/\.config\/gh\/hosts\.yml$/,
  /^~\/\.npmrc$/,
  /^~\/\.pypirc$/,
  /^~\/\.cargo\/credentials\.toml$/,
  /^~\/\.netrc$/,
  /^~\/\.vault-token$/,
  /^~\/\.terraformrc$/,
  /^~\/\.(?:bash_history|zsh_history|zhistory)$/,
  /^~\/Library\/Safari(?:\/|$)/,
  /^~\/Library\/Application Support\/(?:Google\/Chrome|Firefox\/Profiles)(?:\/|$)/,
];

const SENSITIVE_HOME_ALLOW_BACK: ReadonlyArray<RegExp> = [
  /^~\/\.ssh\/(?:config|known_hosts|known_hosts\.old)$/,
  /^~\/\.ssh\/[^/]+\.pub$/,
  /^~\/\.aws\/config$/,
  /^~\/\.config\/gh\/config\.yml$/,
];

/**
 * Literal form of the sensitive home paths, used to judge glob/substitution
 * evasion candidates (`~/.ssh*`, `~/.s?s?`) that the regexes can't match.
 */
const SENSITIVE_HOME_LITERALS: readonly string[] = [
  '~/.ssh',
  '~/.gnupg',
  '~/.aws/credentials',
  '~/.config/gcloud',
  '~/.azure',
  '~/.docker/config.json',
  '~/.kube/config',
  '~/.config/gh/hosts.yml',
  '~/.npmrc',
  '~/.pypirc',
  '~/.cargo/credentials.toml',
  '~/.netrc',
  '~/.vault-token',
  '~/.terraformrc',
  '~/.bash_history',
  '~/.zsh_history',
  '~/.zhistory',
  '~/Library/Safari',
  '~/Library/Application Support/Google/Chrome',
  '~/Library/Application Support/Firefox/Profiles',
];

/**
 * Glob / command-substitution evasion check. A candidate containing `*?[]`
 * can't be resolved statically, so treat it as sensitive when its literal
 * prefix (up to the first metacharacter) overlaps a sensitive path and is
 * long enough to be meaningful (`~/.s` minimum). A `$(...)` substitution
 * directly under a hidden home dot-dir (`~/.$(...)`) is never verifiable —
 * always treat as sensitive. Both cases are UX-layer judgments: they block
 * with a clear reason rather than pretending the path was resolved.
 */
function isObfuscatedSensitiveHomePath(candidate: string): boolean {
  if (candidate.includes('$(')) return candidate.startsWith('~/.');
  if (!/[*?[\]]/.test(candidate)) return false;
  const literalPrefix = candidate.split(/[*?[\]]/, 1)[0];
  if (literalPrefix.length < 4) return false;
  return SENSITIVE_HOME_LITERALS.some(
    literal => literal.startsWith(literalPrefix) || literalPrefix.startsWith(`${literal}/`)
  );
}

function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

function isSafeExternalSink(pathText: string): boolean {
  const value = unquote(pathText);
  return (
    value === '/dev/null' ||
    value.startsWith('/tmp/') ||
    value.startsWith('/var/tmp/') ||
    value.startsWith('$TMPDIR/') ||
    value.startsWith('${TMPDIR}/')
  );
}

function isWorkspaceSourceLikePath(pathText: string): boolean {
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
function shellWords(text: string): string[] {
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
function stripObfuscatingQuotes(command: string): string {
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

function findSourceLikeWord(text: string): string | undefined {
  return shellWords(text).find(isWorkspaceSourceLikePath);
}

function findQuotedSourceLikePath(command: string): string | undefined {
  const pattern = /"([^"]+)"|'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(command))) {
    const value = match[1] ?? match[2];
    if (isWorkspaceSourceLikePath(value)) return value;
  }
  const loosePath =
    /(?:^|[\s"',(])((?:\.\/)?(?:[\w.-]+\/)*(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|AGENTS\.md|README\.md|[.\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|yaml|yml|toml|css|scss|html|rs|go|py|java|kt|c|cc|cpp|h|hpp|sh|sql|txt)))(?=$|[\s"',)])/gi;
  while ((match = loosePath.exec(command))) {
    const value = match[1];
    if (isWorkspaceSourceLikePath(value)) return value;
  }
  return undefined;
}

function normalizeHomePath(value: string): string {
  const unquoted = unquote(value)
    .replace(/^\\(["'])/, '$1')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/^\$HOME(?=\/)/, '~')
    .replace(/^\$\{HOME\}(?=\/)/, '~');
  // os.homedir() (not process.env.HOME): one consistent home source across the
  // guards and bash-tool.ts. On POSIX os.homedir() honors $HOME, so tests that
  // override HOME still work.
  const home = os.homedir().replace(/\/+$/, '');
  if (home && (unquoted === home || unquoted.startsWith(`${home}/`))) {
    return `~${unquoted.slice(home.length)}`;
  }
  return unquoted;
}

function isSensitiveHomePath(value: string): boolean {
  const normalized = normalizeHomePath(value);
  if (SENSITIVE_HOME_ALLOW_BACK.some(pattern => pattern.test(normalized))) return false;
  return SENSITIVE_HOME_PATHS.some(pattern => pattern.test(normalized));
}

function executableName(value: string): string {
  return value.split('/').pop()?.toLowerCase() ?? value.toLowerCase();
}

function isWorkspaceRelativeOperand(value: string | undefined): boolean {
  if (!value) return true;
  return !/^(?:\/|~|[A-Za-z]:[\\/]|\.{2}(?:\/|$))/.test(value);
}

function hasShellControlSyntax(command: string): boolean {
  return /[;&|<>`]/.test(command) || /\$\(/.test(command);
}

function optionValue(words: string[], names: string[]): string | undefined {
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (names.includes(word)) return words[i + 1];
    const prefix = names.find(name => word.startsWith(`${name}=`));
    if (prefix) return word.slice(prefix.length + 1);
  }
  return undefined;
}

function nonOptionOperands(words: string[], skipOptionArgs: Set<string> = new Set()): string[] {
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

function grepSuggestion(words: string[], toolName: string): BashToolRoutingSuggestion | undefined {
  const skipOptionArgs = new Set([
    '-e',
    '--regexp',
    '-f',
    '--file',
    '-g',
    '--glob',
    '--type',
    '-t',
    '-C',
    '--context',
    '-A',
    '--after-context',
    '-B',
    '--before-context',
  ]);
  const operands = nonOptionOperands(words, skipOptionArgs);
  const pattern = operands[0] ?? optionValue(words, ['-e', '--regexp']);
  if (!pattern) return undefined;
  const path = operands[1];
  if (!isWorkspaceRelativeOperand(path)) return undefined;
  const include = optionValue(words, ['-g', '--glob']);
  const caseInsensitive = words.includes('-i') || words.includes('--ignore-case');
  const outputMode =
    words.includes('-l') || words.includes('--files-with-matches')
      ? 'files_with_matches'
      : words.includes('-c') || words.includes('--count')
        ? 'count'
        : 'content';
  return {
    reason: `${toolName} is a pure content search`,
    suggestedTool: 'Grep',
    suggestedInput: {
      pattern,
      ...(path ? { path } : {}),
      ...(include ? { include } : {}),
      ...(caseInsensitive ? { case_insensitive: true } : {}),
      ...(outputMode !== 'content' ? { output_mode: outputMode } : {}),
    },
  };
}

function findSuggestion(words: string[]): BashToolRoutingSuggestion | undefined {
  if (words.some(word => ['-exec', '-execdir', '-delete', '-ok', '-okdir'].includes(word)))
    return undefined;
  const expressionStart = words.findIndex(
    (word, index) =>
      index > 0 && (word.startsWith('-') || word === '(' || word === '!' || word === 'not')
  );
  const roots = words
    .slice(1, expressionStart === -1 ? words.length : expressionStart)
    .filter(word => !word.startsWith('-'));
  if (roots.length > 1) return undefined;
  const root = roots[0];
  if (!isWorkspaceRelativeOperand(root)) return undefined;
  const namePattern = optionValue(words, ['-name', '-iname', '-path', '-ipath']) ?? '**/*';
  return {
    reason: 'find is being used for file discovery',
    suggestedTool: 'Glob',
    suggestedInput: {
      pattern: namePattern,
      ...(root ? { path: root } : {}),
    },
  };
}

export function findBashToolRoutingSuggestion(
  command: string
): BashToolRoutingSuggestion | undefined {
  if (hasShellControlSyntax(command)) return undefined;
  const words = shellWords(command);
  if (words.length === 0) return undefined;
  const exe = executableName(words[0]);

  if (exe === 'ls') {
    const operands = nonOptionOperands(words);
    if (operands.length > 1) return undefined;
    const target = operands[0];
    if (!isWorkspaceRelativeOperand(target)) return undefined;
    if (target && /[*?[\]{}]/.test(target)) {
      return {
        reason: 'ls is being used with a file glob',
        suggestedTool: 'Glob',
        suggestedInput: { pattern: target },
      };
    }
    return {
      reason: 'ls is a pure directory listing',
      suggestedTool: 'LS',
      suggestedInput: target ? { path: target } : {},
    };
  }

  if (exe === 'find' || exe === 'fd') {
    if (exe === 'fd') {
      const operands = nonOptionOperands(words, new Set(['-e', '--extension', '-g', '--glob']));
      const pattern = operands[0] ?? optionValue(words, ['-g', '--glob']) ?? '**/*';
      const root = operands[1];
      if (!isWorkspaceRelativeOperand(root)) return undefined;
      return {
        reason: 'fd is being used for file discovery',
        suggestedTool: 'Glob',
        suggestedInput: { pattern, ...(root ? { path: root } : {}) },
      };
    }
    return findSuggestion(words);
  }

  if (exe === 'rg' || exe === 'grep' || exe === 'ag') {
    return grepSuggestion(words, exe);
  }

  return undefined;
}

export function findBashSensitivePathAccess(command: string): BashSensitivePathMatch | undefined {
  const pathPattern =
    /(~\/(?:[^"'\s;&|)\\]+|Library\/(?:Safari|Application Support\/(?:Google\/Chrome|Firefox\/Profiles))(?:\/[^"'\s;&|)\\]*)?)|\$HOME\/[^"'\s;&|)\\]+|\$\{HOME\}\/[^"'\s;&|)\\]+)/g;
  // os.homedir() (not process.env.HOME): consistent with bash-tool.ts; on
  // POSIX os.homedir() honors $HOME, so tests overriding HOME still work.
  const home = os.homedir().replace(/\/+$/, '');
  const absoluteHomePattern = home
    ? new RegExp(`${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/[^"'\\s;&|)\\\\]+`, 'g')
    : undefined;
  for (const pattern of [pathPattern, absoluteHomePattern].filter((value): value is RegExp =>
    Boolean(value)
  )) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(command))) {
      const candidate = normalizeHomePath(match[0]);
      if (isSensitiveHomePath(candidate) || isObfuscatedSensitiveHomePath(candidate)) {
        return {
          path: candidate,
          reason: `Bash command accesses sensitive home path ${candidate}`,
        };
      }
    }
  }

  // `cd ~ && cat .ssh/id_rsa` style: paths relative to a home `cd` still
  // count. Scan words in the segments following `cd ~` / `cd $HOME` /
  // `cd ${HOME}` (up to the next `cd`) as if prefixed with `~/`.
  const cdHomePattern = /(?:^|[;&|])\s*cd\s+(?:~|\$HOME|\$\{HOME\})(?=\s|&&|;|$)/g;
  let cdMatch: RegExpExecArray | null;
  while ((cdMatch = cdHomePattern.exec(command))) {
    const rest = command.slice(cdMatch.index + cdMatch[0].length);
    const nextCd = rest.slice(1).search(/[;&|]\s*cd\s/);
    const scope = nextCd === -1 ? rest : rest.slice(0, nextCd + 1);
    for (const segment of scope.split(/&&|\|\||[;|]/)) {
      const words = shellWords(segment);
      for (const word of words.slice(1)) {
        if (word.startsWith('-')) continue;
        const candidate = normalizeHomePath(`~/${word}`);
        if (isSensitiveHomePath(candidate) || isObfuscatedSensitiveHomePath(candidate)) {
          return {
            path: candidate,
            reason: `Bash command accesses sensitive home path ${candidate} (relative to cd ~)`,
          };
        }
      }
    }
  }
  return undefined;
}

export function findCriticalBashPattern(command: string): CriticalBashMatch | undefined {
  // Match both the raw command and its normalized form (quote-stripped,
  // split flags merged, `--` collapsed) so cheap obfuscation — `rm -r -f /`,
  // `r"m" -rf /`, `rm -rf -- /` — does not slip through.
  const normalized = normalizeBashCommandForMatch(command);
  for (const { pattern, reason } of CRITICAL_BASH_PATTERNS) {
    if (pattern.test(command) || (normalized !== command && pattern.test(normalized))) {
      return { reason };
    }
  }
  return undefined;
}

export function findBashFileBypass(command: string): BashFileBypassMatch | undefined {
  // Optional fd prefix (`2>`, `2>>`, `1>`): `cmd 2> errors.txt` writes a file
  // just like `>`, so it goes through the same Write-tool routing. `>&`
  // (fd duplication) is still excluded.
  const redirectPattern = /(?<!\d)\d*>>?\s*(?!&)(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g;
  let redirect: RegExpExecArray | null;
  while ((redirect = redirectPattern.exec(command))) {
    const target = redirect[1] ?? redirect[2] ?? redirect[3];
    if (isWorkspaceSourceLikePath(target)) {
      return {
        kind: 'file_write',
        reason: `shell redirection writes ${target}`,
        suggestedTool: 'Write',
      };
    }
  }

  const teeMatch = /(?:^|[\s;&|])tee\s+(?:-[A-Za-z]+\s+)*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/i.exec(
    command
  );
  if (teeMatch) {
    const target = teeMatch[1] ?? teeMatch[2] ?? teeMatch[3];
    if (isWorkspaceSourceLikePath(target)) {
      return {
        kind: 'file_write',
        reason: `tee writes ${target}`,
        suggestedTool: 'Write',
      };
    }
  }

  if (/(?:^|[\s;&|])(?:sed|gsed)\b[^;&|]*\s-i(?:\s|[.='"]|$)/i.test(command)) {
    const target = findSourceLikeWord(command);
    if (target) {
      return {
        kind: 'file_write',
        reason: `sed -i mutates ${target}`,
        suggestedTool: 'Edit',
      };
    }
  }

  if (/(?:^|[\s;&|])perl\b[^;&|]*\s-pi(?:\s|[.='"]|$)/i.test(command)) {
    const target = findSourceLikeWord(command);
    if (target) {
      return {
        kind: 'file_write',
        reason: `perl -pi mutates ${target}`,
        suggestedTool: 'Edit',
      };
    }
  }

  if (
    /\b(?:python|python3|node|ruby|perl)\b[\s\S]*(?:writeFile(?:Sync)?|appendFile(?:Sync)?|open\s*\()/i.test(
      command
    )
  ) {
    const target = findQuotedSourceLikePath(command);
    const writes = /(?:writeFile(?:Sync)?|appendFile(?:Sync)?|open\s*\([^)]*,\s*['"][wa+])/i.test(
      command
    );
    if (writes && target) {
      return {
        kind: 'file_write',
        reason: `script writes ${target}`,
        suggestedTool: 'Edit',
      };
    }
  }

  const readCommandPattern = /(?:^|[\s;&|])(?:cat|bat|less|more|nl|head|tail)\b([^;&|]*)/gi;
  let readMatch: RegExpExecArray | null;
  while ((readMatch = readCommandPattern.exec(command))) {
    const target = findSourceLikeWord(readMatch[1] ?? '');
    if (target) {
      return {
        kind: 'file_read',
        reason: `shell file reader reads ${target}`,
        suggestedTool: 'Read',
        target,
      };
    }
  }

  if (
    /\b(?:python|python3|node|ruby|perl)\b[\s\S]*(?:readFileSync|open\s*\([^)]*\)[\s\S]*\.read\s*\()/i.test(
      command
    )
  ) {
    const target = findQuotedSourceLikePath(command);
    if (target) {
      return {
        kind: 'file_read',
        reason: `script reads ${target}`,
        suggestedTool: 'Read',
        target,
      };
    }
  }

  return undefined;
}
