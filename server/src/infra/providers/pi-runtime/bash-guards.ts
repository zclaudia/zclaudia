/**
 * Critical Bash command patterns — a second gate alongside the sandbox.
 *
 * Kept intentionally tight: the cost of a false negative is data loss or a
 * compromised host, while false positives remain actionable through the
 * permission escalation channel. New patterns should target shapes that are
 * virtually never legitimate in automation.
 */

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
  { pattern: /\bchmod\s+-R\s+[0-7]+\s+\//i, reason: 'recursive permission change on a root-level path' },
  { pattern: /\bchmod\s+-R\s+[ugoa+\-=rwxXst,]+\s+\//, reason: 'recursive permission change on a root-level path' },
  { pattern: /\bchown\s+-R\s+\S+\s+\//i, reason: 'recursive ownership change on a root-level path' },

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
  { pattern: /\btee\s+(?:-a\s+)?\/etc\/(?:passwd|shadow|sudoers)\b/i, reason: 'overwrite of a system auth file' },

  // Remote-fetch-then-execute (curl/wget piped to a shell or process-subbed).
  { pattern: /\b(?:curl|wget|fetch)\b[^|]*\|\s*(?:bash|sh|zsh|fish)\b/i, reason: 'remote fetch piped into a shell (fetch-then-execute)' },
  // Process-sub variants — `bash <(curl …)`, `source <(curl …)`, `. <(curl …)`. `.` and `source` are
  // anchored to a command boundary so `find . -name` and similar don't false-positive.
  { pattern: /(?:^|[\s;&|(])(?:bash|sh|zsh|source|\.)\s+<\(\s*(?:curl|wget|fetch)\b/i, reason: 'remote fetch executed via process substitution (fetch-then-execute)' },
  // `eval "$(curl …)"` / `eval $(curl …)` / `eval \`curl …\``.
  { pattern: /\beval\s+["'`]?\$\(\s*(?:curl|wget|fetch)\b|\beval\s+`\s*(?:curl|wget|fetch)\b/i, reason: 'remote fetch evaluated as code (fetch-then-execute)' },

  // Process/host control.
  { pattern: /\bkill\s+(?:-\S+\s+)?1\b/, reason: 'kill of PID 1' },
  // Must sit at command position so `npm run reboot-tests` or `echo 'shutdown the queue'`
  // don't false-positive.
  { pattern: /(?:^|[\s;&|(])(?:shutdown|poweroff|reboot|halt)(?:\s|$|[;|&])/i, reason: 'host shutdown or reboot' },
  { pattern: /(?:^|[\s;&|(])init\s+0\b/i, reason: 'host shutdown (init 0)' },

  // Network-shell exfil.
  { pattern: /\bnc\b[^|;]*\s-[a-zA-Z]*[ec][a-zA-Z]*\s/i, reason: 'netcat with command execution (reverse shell)' },
];

const SOURCE_OR_CONFIG_PATH = /(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|vite\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|AGENTS\.md|README\.md|[.\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|yaml|yml|toml|css|scss|html|rs|go|py|java|kt|c|cc|cpp|h|hpp|sh|sql|txt))$/i;
const GENERATED_OR_TEMP_PATH = /(?:^|\/)(?:node_modules|dist|build|coverage|target|\.next|\.turbo|\.cache|tmp|temp|logs?)(?:\/|$)/i;

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

function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

function isSafeExternalSink(pathText: string): boolean {
  const value = unquote(pathText);
  return value === '/dev/null'
    || value.startsWith('/tmp/')
    || value.startsWith('/var/tmp/')
    || value.startsWith('$TMPDIR/')
    || value.startsWith('${TMPDIR}/');
}

function isWorkspaceSourceLikePath(pathText: string): boolean {
  const value = unquote(pathText).replace(/^\.\//, '');
  if (!value || value.startsWith('-')) return false;
  if (isSafeExternalSink(value)) return false;
  if (/^[A-Z_][A-Z0-9_]*(?:\/|$)/.test(value)) return false;
  if (GENERATED_OR_TEMP_PATH.test(value)) return false;
  return SOURCE_OR_CONFIG_PATH.test(value);
}

function shellWords(text: string): string[] {
  const words: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|([^\s;&|<>]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) words.push(match[1] ?? match[2] ?? match[3]);
  return words;
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
  const loosePath = /(?:^|[\s"',(])((?:\.\/)?(?:[\w.-]+\/)*(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|AGENTS\.md|README\.md|[.\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|yaml|yml|toml|css|scss|html|rs|go|py|java|kt|c|cc|cpp|h|hpp|sh|sql|txt)))(?=$|[\s"',)])/ig;
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
  const home = process.env.HOME?.replace(/\/+$/, '');
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
  const skipOptionArgs = new Set(['-e', '--regexp', '-f', '--file', '-g', '--glob', '--type', '-t', '-C', '--context', '-A', '--after-context', '-B', '--before-context']);
  const operands = nonOptionOperands(words, skipOptionArgs);
  const pattern = operands[0] ?? optionValue(words, ['-e', '--regexp']);
  if (!pattern) return undefined;
  const path = operands[1];
  if (!isWorkspaceRelativeOperand(path)) return undefined;
  const include = optionValue(words, ['-g', '--glob']);
  const caseInsensitive = words.includes('-i') || words.includes('--ignore-case');
  const outputMode = words.includes('-l') || words.includes('--files-with-matches')
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
  if (words.some(word => ['-exec', '-execdir', '-delete', '-ok', '-okdir'].includes(word))) return undefined;
  const expressionStart = words.findIndex((word, index) => index > 0 && (word.startsWith('-') || word === '(' || word === '!' || word === 'not'));
  const roots = words.slice(1, expressionStart === -1 ? words.length : expressionStart).filter(word => !word.startsWith('-'));
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

export function findBashToolRoutingSuggestion(command: string): BashToolRoutingSuggestion | undefined {
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
  const pathPattern = /(~\/(?:[^"'\s;&|)\\]+|Library\/(?:Safari|Application Support\/(?:Google\/Chrome|Firefox\/Profiles))(?:\/[^"'\s;&|)\\]*)?)|\$HOME\/[^"'\s;&|)\\]+|\$\{HOME\}\/[^"'\s;&|)\\]+)/g;
  const home = process.env.HOME?.replace(/\/+$/, '');
  const absoluteHomePattern = home
    ? new RegExp(`${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/[^"'\\s;&|)\\\\]+`, 'g')
    : undefined;
  for (const pattern of [pathPattern, absoluteHomePattern].filter((value): value is RegExp => Boolean(value))) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(command))) {
      const candidate = normalizeHomePath(match[0]);
      if (isSensitiveHomePath(candidate)) {
        return {
          path: candidate,
          reason: `Bash command accesses sensitive home path ${candidate}`,
        };
      }
    }
  }
  return undefined;
}

export function findCriticalBashPattern(command: string): CriticalBashMatch | undefined {
  for (const { pattern, reason } of CRITICAL_BASH_PATTERNS) {
    if (pattern.test(command)) return { reason };
  }
  return undefined;
}

export function findBashFileBypass(command: string): BashFileBypassMatch | undefined {
  const redirectPattern = /(?:^|[^0-9])>>?\s*(?!&)(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g;
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

  const teeMatch = /(?:^|[\s;&|])tee\s+(?:-[A-Za-z]+\s+)*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/i.exec(command);
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

  if (/\b(?:python|python3|node|ruby|perl)\b[\s\S]*(?:writeFile(?:Sync)?|appendFile(?:Sync)?|open\s*\()/i.test(command)) {
    const target = findQuotedSourceLikePath(command);
    const writes = /(?:writeFile(?:Sync)?|appendFile(?:Sync)?|open\s*\([^)]*,\s*['"][wa+])/i.test(command);
    if (writes && target) {
      return {
        kind: 'file_write',
        reason: `script writes ${target}`,
        suggestedTool: 'Edit',
      };
    }
  }

  const readCommandPattern = /(?:^|[\s;&|])(?:cat|bat|less|more|nl|head|tail)\b([^;&|]*)/ig;
  let readMatch: RegExpExecArray | null;
  while ((readMatch = readCommandPattern.exec(command))) {
    const target = findSourceLikeWord(readMatch[1] ?? '');
    if (target) {
      return {
        kind: 'file_read',
        reason: `shell file reader reads ${target}`,
        suggestedTool: 'Read',
      };
    }
  }

  if (/\b(?:python|python3|node|ruby|perl)\b[\s\S]*(?:readFileSync|open\s*\([^)]*\)[\s\S]*\.read\s*\()/i.test(command)) {
    const target = findQuotedSourceLikePath(command);
    if (target) {
      return {
        kind: 'file_read',
        reason: `script reads ${target}`,
        suggestedTool: 'Read',
      };
    }
  }

  return undefined;
}
