const TOOL_NAME_RE = /^(\*|[A-Za-z_][A-Za-z0-9_]*)$/;
const REGEX_SPECIALS = /[.+^${}()|[\]\\]/g;

export interface ParsedToolRule {
  toolName: string;
  pattern?: string;
}

export type ToolRuleParseResult = { ok: true; rule: ParsedToolRule } | { ok: false; error: string };

/**
 * Compile a rule glob into an anchored regex source (matched case-insensitively
 * by the evaluator). `*` → `.*`, `?` → `.`, everything else literal. A trailing
 * " *" compiles to `(\s.*)?$` so `git push *` matches both the bare command and
 * any argument form — the prefix-rule blind spot openclaude's syntax has.
 */
export function compileGlob(glob: string): string {
  let body = glob;
  let suffix = '$';
  if (body.endsWith(' *')) {
    body = body.slice(0, -2);
    suffix = '(\\s.*)?$';
  }
  const escaped = body.replace(REGEX_SPECIALS, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return `^${escaped}${suffix}`;
}

/** Parse `ToolName`, `ToolName(glob)`, or advanced `ToolName(/regex/)`. */
export function parseToolRule(text: string): ToolRuleParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Rule is empty' };
  const parenIdx = trimmed.indexOf('(');
  if (parenIdx === -1) {
    if (!TOOL_NAME_RE.test(trimmed)) return { ok: false, error: `Invalid tool name: ${trimmed}` };
    return { ok: true, rule: { toolName: trimmed } };
  }
  if (!trimmed.endsWith(')')) return { ok: false, error: 'Missing closing parenthesis' };
  const toolName = trimmed.slice(0, parenIdx);
  const inner = trimmed.slice(parenIdx + 1, -1);
  if (!TOOL_NAME_RE.test(toolName)) return { ok: false, error: `Invalid tool name: ${toolName}` };
  if (!inner) return { ok: false, error: 'Empty pattern' };
  if (inner.length > 2 && inner.startsWith('/') && inner.endsWith('/')) {
    const source = inner.slice(1, -1);
    try {
      new RegExp(source);
    } catch {
      return { ok: false, error: `Invalid regex: ${source}` };
    }
    return { ok: true, rule: { toolName, pattern: source } };
  }
  return { ok: true, rule: { toolName, pattern: compileGlob(inner) } };
}

/** Characters our compiler can emit unescaped inside a glob body. */
const GLOB_LITERAL_RE = /[A-Za-z0-9_\-\s/:=@,~'"#%&!]/;

/** Characters that compileGlob itself escapes; only these are valid `\X` sequences in compiler-produced patterns. */
const COMPILER_ESCAPED = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);

/**
 * Attempt to decompile a regex source back to a glob pattern. Only decompiles
 * patterns produced by compileGlob; any construct compileGlob cannot emit returns null.
 */
function tryRegexToGlob(source: string): string | null {
  if (!source.startsWith('^')) return null;
  let body = source.slice(1);
  let trailing = '';
  if (body.endsWith('(\\s.*)?$')) {
    body = body.slice(0, -'(\\s.*)?$'.length);
    trailing = ' *';
  } else if (body.endsWith('$')) {
    body = body.slice(0, -1);
  } else {
    return null;
  }
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      const next = body[i + 1];
      if (next === undefined) return null;
      if (!COMPILER_ESCAPED.has(next)) return null; // foreign escape sequence
      out += next;
      i++;
    } else if (ch === '.') {
      if (body[i + 1] === '*') {
        out += '*';
        i++;
      } else {
        out += '?';
      }
    } else if (GLOB_LITERAL_RE.test(ch)) {
      out += ch;
    } else {
      return null; // unescaped regex construct — not produced by compileGlob
    }
  }
  return out + trailing;
}

/**
 * Render a stored rule back to rule text. Compiler-produced regexes decompile
 * to glob form; foreign/hand-written regexes display as `ToolName(/regex/)`
 * (still parseable back via the advanced channel).
 */
export function formatToolRule(rule: { toolName: string; pattern?: string }): string {
  if (!rule.pattern) return rule.toolName;
  const glob = tryRegexToGlob(rule.pattern);
  return glob !== null ? `${rule.toolName}(${glob})` : `${rule.toolName}(/${rule.pattern}/)`;
}

/**
 * Suggested rule for the approval modal's "always allow" flow. Bash commands
 * get a two-word prefix (`Bash(git push *)`); single-word commands get an
 * exact rule; other tools get the bare tool name. Words containing rule
 * syntax characters fall back to the bare tool to avoid generating unparseable
 * text — the user can still edit.
 */
export function suggestRuleForRequest(toolName: string, detail: string): string {
  if (toolName !== 'Bash') return toolName;
  const words = detail.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'Bash';
  const unsafe = (w: string) => /[()/]/.test(w) || w.includes('*') || w.includes('?');
  if (words.length === 1) return unsafe(words[0]) ? 'Bash' : `Bash(${words[0]})`;
  if (unsafe(words[0]) || unsafe(words[1])) return 'Bash';
  return `Bash(${words[0]} ${words[1]} *)`;
}
