/**
 * Tool-routing suggestions: detect plain read/discovery/write commands that
 * ZClaudia has a dedicated tool for (LS / Glob / Grep / Read / Edit / Write)
 * so the model can be steered toward the structured tool instead of shell.
 *
 * See bash-guards.ts header for the honest scope.
 */

import {
  executableName,
  hasShellControlSyntax,
  isWorkspaceRelativeOperand,
  isWorkspaceSourceLikePath,
  nonOptionOperands,
  optionValue,
  shellWords,
} from './normalize.js';

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
  // Any shell control syntax disables ALL tool-routing steering for the
  // command: a pipeline/compound command runs exactly as written, even when
  // one segment is a plain `ls`/`grep`. Deliberate trade-off (statically
  // splitting compound commands would misparse quoting/subshells), documented
  // in the Bash tool description so the behavior is visible to the model.
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
