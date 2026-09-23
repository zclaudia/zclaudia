/**
 * Declarative read-only policies, evaluated per simple command (argv).
 *
 * Verdicts are tri-state: `true` (provably read-only), `false` (known to
 * write or otherwise unsafe), `undefined` (no policy → unknown). The caller
 * treats `undefined` the same as `false`; the distinction only exists so
 * tests and diagnostics can tell "we never heard of it" from "we know it
 * writes".
 *
 * Path arguments are NOT inspected here: reading `~/.ssh/id_rsa` is still a
 * read. The sensitive-file and outside-workspace guards in the permission
 * evaluator run before category lookup and keep escalating those.
 */

import type { BashInvocation } from './analyze.js';

export type ReadonlyVerdict = true | false | undefined;

export interface CommandPolicy {
  /** Any argument shape is fine (the program has no write path). */
  allowAnyArgs?: boolean;
  /** Only the bare command with no arguments is read-only. */
  commandOnly?: boolean;
  /** Flags that must never appear (checked by exact token or `--flag=` prefix). */
  denyFlags?: string[];
  /** Short-flag letters that must never appear inside a bundled `-abc` group. */
  denyShortLetters?: string;
  /** Maximum number of positional (non-flag) operands allowed. */
  maxPositional?: number;
  /** Extra per-command check run after the generic ones. */
  check?: (argv: string[]) => ReadonlyVerdict;
}

/** Commands that can only ever read or print, whatever their arguments. */
const ALLOW_ANY_ARGS = new Set([
  'basename',
  'cal',
  'cat',
  'cd',
  'cksum',
  'cmp',
  'column',
  'comm',
  'cut',
  'df',
  'diff',
  'dirname',
  'du',
  'echo',
  'expand',
  'expr',
  'false',
  'file',
  'fmt',
  'fold',
  'free',
  'groups',
  'head',
  'hexdump',
  'id',
  'jq',
  'locale',
  'ls',
  'md5sum',
  'nl',
  'nproc',
  'numfmt',
  'od',
  'paste',
  'popd',
  'pr',
  'printf',
  'pushd',
  'pwd',
  'readlink',
  'realpath',
  'rev',
  'seq',
  'sha1sum',
  'sha256sum',
  'sha512sum',
  'shasum',
  'stat',
  'strings',
  'tac',
  'tail',
  'test',
  '[',
  'tr',
  'true',
  ':',
  'tsort',
  'type',
  'uname',
  'unexpand',
  'uptime',
  'wc',
  'which',
  'whereis',
  'whoami',
  'arch',
  'printenv',
  'lsof',
  'pgrep',
  'ps',
  'ss',
  'netstat',
  'ldd',
  'nm',
]);

const FLAG_ONLY_INFO = new Set(['--version', '-V', '--help', '-h']);

function hasFlag(argv: string[], flags: string[]): boolean {
  return argv.some(arg => flags.some(flag => arg === flag || arg.startsWith(`${flag}=`)));
}

function hasShortLetter(argv: string[], letters: string): boolean {
  return argv.some(
    arg => /^-[A-Za-z]+$/.test(arg) && [...arg.slice(1)].some(letter => letters.includes(letter))
  );
}

function positionals(argv: string[]): string[] {
  const out: string[] = [];
  let doubleDash = false;
  for (const arg of argv) {
    if (doubleDash) {
      out.push(arg);
      continue;
    }
    if (arg === '--') {
      doubleDash = true;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) continue;
    out.push(arg);
  }
  return out;
}

/**
 * sed scripts allowed without in-place editing: line-address print/delete/
 * quit forms and substitutions whose flags exclude `e` (execute) and `w`
 * (write). Everything else (`w file`, `r file`, `e cmd`, `-f script`) is
 * unknown → unprovable.
 */
const SED_ADDRESS = String.raw`(?:\d+|\$|/(?:[^/\\]|\\.)*/)?(?:,(?:\d+|\$|\+\d+|~\d+|/(?:[^/\\]|\\.)*/))?!?`;
const SED_SIMPLE = new RegExp(`^${SED_ADDRESS}[pPdq=lF]?$`);
const SED_SUBST = new RegExp(
  `^${SED_ADDRESS}(?:s|y)([/|#@%,~^])(?:(?!\\1)[^\\\\]|\\\\.)*\\1(?:(?!\\1)[^\\\\]|\\\\.)*\\1[gIimM0-9p]*$`
);

function isSafeSedScript(script: string): boolean {
  return script
    .split(/;|\n/)
    .map(part => part.trim())
    .filter(Boolean)
    .every(part => SED_SIMPLE.test(part) || SED_SUBST.test(part));
}

function sedCheck(argv: string[]): ReadonlyVerdict {
  const args = argv.slice(1);
  if (hasFlag(args, ['-i', '--in-place', '-f', '--file', '-s', '--separate'])) return false;
  if (hasShortLetter(args, 'ifs')) return false;
  const scripts: string[] = [];
  const files: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-e' || arg === '--expression') {
      const value = args[i + 1];
      if (value === undefined) return false;
      scripts.push(value);
      i += 1;
      continue;
    }
    if (arg.startsWith('--expression=')) {
      scripts.push(arg.slice('--expression='.length));
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      if (
        !/^-(?:n|E|r|z|u|--quiet|--silent|--regexp-extended|--posix|--null-data|--unbuffered|--debug|--sandbox)$/.test(
          arg
        ) &&
        !/^-[nErzu]+$/.test(arg)
      ) {
        return false;
      }
      continue;
    }
    if (scripts.length === 0) scripts.push(arg);
    else files.push(arg);
  }
  if (scripts.length === 0) return false;
  return scripts.every(isSafeSedScript) ? true : false;
}

const SIMPLE_POLICIES: Record<string, CommandPolicy> = {
  grep: { denyFlags: [] },
  egrep: {},
  fgrep: {},
  rg: { denyFlags: ['--pre', '--pre-glob'] },
  ag: {},
  find: {
    denyFlags: [
      '-exec',
      '-execdir',
      '-ok',
      '-okdir',
      '-delete',
      '-fprint',
      '-fprint0',
      '-fprintf',
      '-fls',
    ],
  },
  fd: { denyFlags: ['-x', '--exec', '-X', '--exec-batch'] },
  fdfind: { denyFlags: ['-x', '--exec', '-X', '--exec-batch'] },
  tree: { denyFlags: ['-o'] },
  sort: { denyFlags: ['-o', '--output'], denyShortLetters: 'o' },
  uniq: { maxPositional: 1 },
  date: { denyFlags: ['-s', '--set'] },
  hostname: { maxPositional: 0 },
  env: { commandOnly: true },
  alias: { commandOnly: true },
  base64: {},
  xxd: { maxPositional: 1, denyFlags: ['-r', '-revert'] },
  sed: { check: sedCheck },
  prettier: {
    check: argv => {
      const args = argv.slice(1);
      if (hasFlag(args, ['--write', '-w'])) return false;
      return hasFlag(args, ['--check', '-c', '--list-different', '-l']) ? true : false;
    },
  },
  npm: { check: argv => npmLikeCheck(argv, NPM_READ_SUBCOMMANDS) },
  pnpm: { check: argv => npmLikeCheck(argv, PNPM_READ_SUBCOMMANDS) },
  yarn: { check: argv => npmLikeCheck(argv, YARN_READ_SUBCOMMANDS) },
  docker: { check: argv => npmLikeCheck(argv, new Set(['ps', 'images', 'version', 'info'])) },
  cargo: { check: argv => npmLikeCheck(argv, new Set(['tree', 'metadata', '--version'])) },
  go: { check: argv => npmLikeCheck(argv, new Set(['version', 'env', 'list'])) },
};

const NPM_READ_SUBCOMMANDS = new Set([
  'ls',
  'list',
  'll',
  'view',
  'info',
  'show',
  'outdated',
  'why',
  'explain',
  'root',
  'prefix',
  'ping',
  'config',
  'get',
]);
const PNPM_READ_SUBCOMMANDS = new Set([
  'ls',
  'list',
  'why',
  'outdated',
  'view',
  'info',
  'root',
  'store',
]);
const YARN_READ_SUBCOMMANDS = new Set(['why', 'info', 'list', 'outdated', 'versions']);

function npmLikeCheck(argv: string[], readSubcommands: Set<string>): ReadonlyVerdict {
  const args = argv.slice(1);
  const sub = args.find(arg => !arg.startsWith('-'));
  if (!sub) return undefined;
  if (!readSubcommands.has(sub)) return undefined;
  // `npm config set`, `pnpm store prune`, `cargo ... --fix` all mutate.
  const rest = args.slice(args.indexOf(sub) + 1);
  if (sub === 'config' && rest[0] !== 'get' && rest[0] !== 'list' && rest[0] !== 'ls') return false;
  if (sub === 'store' && rest[0] !== 'path' && rest[0] !== 'status') return false;
  return true;
}

/** git: read-only subcommands, with the flags that turn them into writes. */
const GIT_READONLY_SUBCOMMANDS: Record<string, CommandPolicy> = {
  status: {},
  log: { denyFlags: ['--output'] },
  diff: { denyFlags: ['--output'] },
  show: { denyFlags: ['--output'] },
  blame: {},
  'rev-parse': {},
  'rev-list': {},
  'ls-files': {},
  'ls-tree': {},
  'ls-remote': {},
  'cat-file': {},
  describe: {},
  shortlog: {},
  'name-rev': {},
  'merge-base': {},
  'check-ignore': {},
  'check-attr': {},
  'diff-tree': {},
  'diff-index': {},
  'diff-files': {},
  'count-objects': {},
  'for-each-ref': {},
  'show-ref': {},
  'show-branch': {},
  grep: { denyFlags: ['--open-files-in-pager', '-O'] },
  whatchanged: {},
  var: {},
  version: {},
  help: {},
  branch: {
    check: argv => {
      const args = argv.slice(2);
      if (
        hasFlag(args, [
          '-d',
          '-D',
          '--delete',
          '-m',
          '-M',
          '--move',
          '-c',
          '-C',
          '--copy',
          '-u',
          '--set-upstream-to',
          '--unset-upstream',
          '--edit-description',
          '-f',
          '--force',
          '--track',
          '--no-track',
        ])
      )
        return false;
      if (hasShortLetter(args, 'dDmMcCuf')) return false;
      // Positional arg without a list flag = create branch.
      const pos = positionals(args);
      if (pos.length === 0) return true;
      return hasFlag(args, [
        '-l',
        '--list',
        '--contains',
        '--no-contains',
        '--merged',
        '--no-merged',
        '--points-at',
        '-a',
        '-r',
      ]) || hasShortLetter(args, 'lar')
        ? true
        : false;
    },
  },
  tag: {
    check: argv => {
      const args = argv.slice(2);
      if (
        hasFlag(args, [
          '-d',
          '--delete',
          '-a',
          '--annotate',
          '-s',
          '--sign',
          '-f',
          '--force',
          '-m',
          '-F',
          '-u',
          '--local-user',
        ])
      )
        return false;
      if (hasShortLetter(args, 'dasfmFu')) return false;
      const pos = positionals(args);
      if (pos.length === 0) return true;
      return hasFlag(args, [
        '-l',
        '--list',
        '--contains',
        '--no-contains',
        '--merged',
        '--no-merged',
        '--points-at',
      ]) ||
        hasShortLetter(args, 'l') ||
        pos.every(arg => arg.includes('*'))
        ? true
        : false;
    },
  },
  remote: {
    check: argv => {
      const args = argv.slice(2);
      const pos = positionals(args);
      if (pos.length === 0) return true;
      if (pos[0] === 'show' || pos[0] === 'get-url') return true;
      return false;
    },
  },
  stash: {
    check: argv => {
      const pos = positionals(argv.slice(2));
      return pos[0] === 'list' || pos[0] === 'show' ? true : false;
    },
  },
  worktree: {
    check: argv => (positionals(argv.slice(2))[0] === 'list' ? true : false),
  },
  submodule: {
    check: argv => (positionals(argv.slice(2))[0] === 'status' ? true : false),
  },
  reflog: {
    check: argv => {
      const pos = positionals(argv.slice(2));
      return pos.length === 0 || pos[0] === 'show' ? true : false;
    },
  },
  config: {
    check: argv => {
      const args = argv.slice(2);
      if (
        hasFlag(args, [
          '--get',
          '--get-all',
          '--get-regexp',
          '--list',
          '-l',
          '--show-origin',
          '--show-scope',
        ])
      ) {
        return hasFlag(args, [
          '--edit',
          '-e',
          '--unset',
          '--unset-all',
          '--add',
          '--replace-all',
          '--rename-section',
          '--remove-section',
        ])
          ? false
          : true;
      }
      return false;
    },
  },
};

const GIT_GLOBAL_DANGEROUS_FLAGS = [
  '-c',
  '-C',
  '--git-dir',
  '--work-tree',
  '--exec-path',
  '--namespace',
  '--config-env',
  '--bare',
  '--super-prefix',
  '--attr-source',
  '--shallow-file',
];
const GIT_GLOBAL_SAFE_FLAGS = new Set([
  '--no-pager',
  '-P',
  '--paginate',
  '-p',
  '--no-optional-locks',
  '--literal-pathspecs',
  '--glob-pathspecs',
  '--noglob-pathspecs',
  '--icase-pathspecs',
  '--no-replace-objects',
]);

function gitVerdict(argv: string[]): ReadonlyVerdict {
  const args = argv.slice(1);
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    const flag = args[index];
    if (GIT_GLOBAL_DANGEROUS_FLAGS.some(bad => flag === bad || flag.startsWith(`${bad}=`)))
      return false;
    if (!GIT_GLOBAL_SAFE_FLAGS.has(flag)) return false;
    index += 1;
  }
  const sub = args[index];
  if (!sub) return true; // bare `git` prints usage
  const policy = GIT_READONLY_SUBCOMMANDS[sub];
  if (!policy) return undefined;
  const subArgv = ['git', sub, ...args.slice(index + 1)];
  if (hasFlag(subArgv.slice(2), ['--output'])) return false;
  return applyPolicy(policy, subArgv, 2);
}

function applyPolicy(policy: CommandPolicy, argv: string[], argStart: number): ReadonlyVerdict {
  const args = argv.slice(argStart);
  if (policy.commandOnly) return args.length === 0 ? true : false;
  if (policy.denyFlags && hasFlag(args, policy.denyFlags)) return false;
  if (policy.denyShortLetters && hasShortLetter(args, policy.denyShortLetters)) return false;
  if (policy.maxPositional !== undefined && positionals(args).length > policy.maxPositional)
    return false;
  if (policy.check) return policy.check(argv);
  return true;
}

/** Wrappers that only affect how the inner command runs, not what it does. */
function unwrap(argv: string[]): string[] | undefined {
  let current = argv;
  for (let guard = 0; guard < 4; guard += 1) {
    const [head, ...rest] = current;
    if (
      head === 'command' ||
      head === 'builtin' ||
      head === 'time' ||
      head === 'nice' ||
      head === 'noglob'
    ) {
      const stripped = rest.filter(
        (arg, i) =>
          !(i === 0 && head === 'command' && (arg === '-p' || arg === '-v' || arg === '-V'))
      );
      if (head === 'command' && (rest[0] === '-v' || rest[0] === '-V')) return ['command', ...rest];
      current = stripped;
      continue;
    }
    if (head === 'timeout') {
      // timeout [-s SIG] [-k N] DURATION cmd…
      let i = 0;
      while (i < rest.length && rest[i].startsWith('-'))
        i += rest[i] === '-s' || rest[i] === '-k' ? 2 : 1;
      if (i >= rest.length) return undefined;
      current = rest.slice(i + 1);
      continue;
    }
    if (head === 'env' && rest.length > 0 && !rest[0].startsWith('-') && !rest[0].includes('=')) {
      current = rest;
      continue;
    }
    if (head === 'xargs') {
      let i = 0;
      while (i < rest.length && rest[i].startsWith('-')) {
        const flag = rest[i];
        if (
          [
            '-n',
            '-I',
            '-d',
            '-P',
            '-L',
            '-s',
            '--max-args',
            '--replace',
            '--delimiter',
            '--max-procs',
          ].includes(flag)
        )
          i += 2;
        else if (
          /^-[0rtx]$|^--null$|^--no-run-if-empty$|^--verbose$|^-I.+$|^-n\d+$|^-P\d+$/.test(flag)
        )
          i += 1;
        else return undefined;
      }
      if (i >= rest.length) return undefined;
      current = rest.slice(i);
      continue;
    }
    return current;
  }
  return undefined;
}

export function executableName(word: string): string {
  const slash = word.lastIndexOf('/');
  return slash >= 0 ? word.slice(slash + 1) : word;
}

export function evaluateReadonlyPolicy(invocation: BashInvocation): ReadonlyVerdict {
  const argv = unwrap(invocation.argv);
  if (!argv || argv.length === 0) return undefined;
  if (argv[0] === 'command' && (argv[1] === '-v' || argv[1] === '-V')) return true;
  const name = executableName(argv[0]);
  if (name !== argv[0] && !argv[0].startsWith('/')) return undefined; // relative script path
  if (name === 'git') return gitVerdict(argv);
  if (argv.length === 2 && FLAG_ONLY_INFO.has(argv[1]) && /^[A-Za-z0-9_.+-]+$/.test(name))
    return true;
  if (ALLOW_ANY_ARGS.has(name)) return true;
  const policy = SIMPLE_POLICIES[name];
  if (!policy) return undefined;
  return applyPolicy(policy, argv, 1);
}
