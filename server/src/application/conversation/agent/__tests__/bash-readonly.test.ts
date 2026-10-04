import { describe, expect, it } from 'vitest';

import {
  analyzeBashCommand,
  classifyReadonlyBashCommand,
  isProvablyReadOnlyBashCommand,
} from '../bash-readonly/index.js';

const READ_ONLY = [
  'ls',
  'ls -la',
  'ls -la src/',
  '/bin/ls -1',
  'cat file.txt',
  'cat a.txt b.txt | head -20',
  'head -n 50 README.md',
  'tail -f logs/app.log',
  'wc -l src/*.ts',
  'pwd',
  'echo hello world',
  'printf "%s\\n" a b',
  'stat package.json',
  'file dist/index.js',
  'du -sh node_modules',
  'df -h',
  'tree -L 2',
  'find . -name "*.ts" -not -path "*/node_modules/*"',
  'find src -type f | wc -l',
  'fd ".test.ts$" src',
  'grep -rn "TODO" src',
  'grep -rn TODO src | head',
  'rg -n "foo" --type ts',
  'rg --files | grep test',
  'git status',
  'git status --short',
  'git diff',
  'git diff --stat HEAD~1',
  'git log --oneline -n 20',
  'git --no-pager log -5',
  'git show HEAD:src/index.ts',
  'git blame src/a.ts',
  'git branch',
  'git branch -a',
  'git branch --list "feat/*"',
  'git branch --show-current',
  'git tag -l',
  'git rev-parse HEAD',
  'git ls-files',
  'git remote -v',
  'git remote show origin',
  'git stash list',
  'git worktree list',
  'git config --get user.name',
  'git config --list',
  'git reflog',
  'git describe --tags',
  'sed -n "1,20p" file.ts',
  "sed -n '/foo/p' file.ts",
  "sed 's/foo/bar/g' file.ts",
  "sed -e '5d' file.ts",
  'sort -u names.txt',
  'sort names.txt | uniq -c',
  'cut -d: -f1 /etc/passwd',
  'tr a-z A-Z < file.txt',
  'diff a.txt b.txt',
  'jq .version package.json',
  'cat package.json | jq -r .name',
  'which node',
  'node --version',
  'pnpm --version',
  'tsc --version',
  'npm ls react',
  'pnpm why vitest',
  'npm view react version',
  'ps aux | grep node',
  'date',
  'uname -a',
  'whoami',
  'env',
  'printenv HOME',
  'test -f package.json && echo yes',
  '[ -d src ] && ls src',
  'cd src && ls',
  'cd src; cat index.ts',
  'true',
  'ls 2>/dev/null',
  'ls > /dev/null',
  'ls 2>&1',
  'ls >/dev/null 2>&1',
  'xargs -0 grep foo',
  'find . -name "*.ts" | xargs grep -l TODO',
  'timeout 5 cat big.log',
  'command -v rg',
  'prettier --check src',
  'ls -la ~/.config',
  "echo '$HOME'",
  'ls *.ts',
  'cat "file with spaces.txt"',
  'grep -e "a" -e "b" file',
  'git log --format="%H %s"',
];

const NOT_READ_ONLY = [
  '',
  '   ',
  'rm -rf /',
  'rm file.txt',
  'mv a b',
  'cp a b',
  'touch a',
  'mkdir x',
  'ls > out.txt',
  'ls >> out.txt',
  'cat a > b',
  'echo hi | tee out.txt',
  'sed -i "s/a/b/" file',
  'sed -i.bak "s/a/b/" file',
  "sed 's/a/b/w out.txt' file",
  "sed -n 'w out.txt' file",
  'sed -f script.sed file',
  "sed 's/a/b/e' file",
  'sort -o out.txt in.txt',
  'sort -no out.txt in.txt',
  'uniq in.txt out.txt',
  'find . -delete',
  'find . -name "*.log" -exec rm {} \\;',
  'find . -exec echo {} \\;',
  'fd -x rm',
  'fd --exec rm',
  'tree -o out.txt',
  'date -s "2020-01-01"',
  'hostname newname',
  'git commit -m x',
  'git add .',
  'git checkout main',
  'git switch main',
  'git branch new-branch',
  'git branch -d old',
  'git branch -D old',
  'git branch -m old new',
  'git tag v1.0',
  'git tag -d v1.0',
  'git stash',
  'git stash pop',
  'git stash drop',
  'git remote add origin url',
  'git remote remove origin',
  'git config user.name x',
  'git config --unset user.name',
  'git worktree add ../x',
  'git log --output=/tmp/x',
  'git -c core.hooksPath=/tmp/x status',
  'git -C /elsewhere status',
  'git --git-dir=/x status',
  'cd /tmp && git status',
  'git status && cd ..',
  'git reset --hard',
  'git rebase main',
  'git merge x',
  'npm install',
  'npm test',
  'npm run build',
  'pnpm install',
  'pnpm store prune',
  'npm config set registry x',
  'node script.js',
  "node -e \"require('fs').writeFileSync('x','y')\"",
  'python3 script.py',
  'bash run.sh',
  './run.sh',
  'sh -c "ls"',
  'ls $(rm -rf x)',
  'echo "$(still runs)"',
  'ls `rm x`',
  'ls $HOME',
  'ls ${HOME}',
  'ls $1',
  'ls "$HOME"',
  'ls; rm x',
  'ls && rm x',
  'ls || rm x',
  'ls | rm x',
  'ls &',
  'cat f &',
  'ls |& cat',
  '(cd x && ls)',
  '{ ls; }',
  'ls {a,b}',
  'cat <(ls)',
  'cat <<EOF\nhi\nEOF',
  'ls\nrm x',
  'LC_ALL=C sort x',
  'GIT_DIR=/x git status',
  'env FOO=bar ls',
  'sudo ls',
  'xargs rm',
  'find . | xargs rm -rf',
  'timeout 5 rm x',
  'command rm x',
  'eval ls',
  'export FOO=1',
  'exec ls',
  'source x.sh',
  '. x.sh',
  'awk "{print}" file',
  'perl -e 1',
  'rg --pre cat foo',
  'prettier --write src',
  'prettier src',
  'curl https://example.com',
  'gh pr view 1',
  'docker run x',
  'xxd -r in out',
  'unknowncommand --flag',
  'ls "unterminated',
  'ls 2> err.txt',
  'ls >& out.txt',
  'ls &> out.txt',
];

describe('isProvablyReadOnlyBashCommand', () => {
  for (const command of READ_ONLY) {
    it(`read-only: ${JSON.stringify(command)}`, () => {
      expect(classifyReadonlyBashCommand(command)).toEqual({ readOnly: true });
    });
  }

  for (const command of NOT_READ_ONLY) {
    it(`not read-only: ${JSON.stringify(command)}`, () => {
      const result = classifyReadonlyBashCommand(command);
      expect(result.readOnly).toBe(false);
      expect(result.reason).toBeTruthy();
      expect(isProvablyReadOnlyBashCommand(command)).toBe(false);
    });
  }

  it('rejects over-long commands without parsing them', () => {
    expect(isProvablyReadOnlyBashCommand(`ls ${'a'.repeat(20_000)}`)).toBe(false);
  });
});

describe('analyzeBashCommand', () => {
  it('splits pipelines and sequences into argv lists with quote flags', () => {
    const analysis = analyzeBashCommand('grep -n "a b" src | head -5; ls');
    expect(analysis.ok).toBe(true);
    expect(analysis.invocations.map(inv => inv.argv)).toEqual([
      ['grep', '-n', 'a b', 'src'],
      ['head', '-5'],
      ['ls'],
    ]);
    expect(analysis.invocations[0].words[2].quoted).toBe(true);
    expect(analysis.invocations[0].words[1].quoted).toBe(false);
  });

  it('strips /dev/null and fd-dup redirects but rejects file redirects', () => {
    expect(analyzeBashCommand('ls 2>/dev/null >/dev/null 2>&1').invocations[0].argv).toEqual([
      'ls',
    ]);
    expect(analyzeBashCommand('ls > out').ok).toBe(false);
    expect(analyzeBashCommand('ls >out').reason).toMatch(/output redirect to out/);
    expect(analyzeBashCommand('ls "2>" x').invocations[0].argv).toEqual(['ls', '2>', 'x']);
  });

  it('reports the unsupported construct', () => {
    expect(analyzeBashCommand('ls $(pwd)').reason).toBe('command substitution');
    expect(analyzeBashCommand('ls `pwd`').reason).toBe('backtick substitution');
    expect(analyzeBashCommand('ls ${HOME}').reason).toBe('parameter expansion');
    expect(analyzeBashCommand('ls $HOME').reason).toBe('variable expansion');
    expect(analyzeBashCommand('ls &').reason).toBe('background job');
    expect(analyzeBashCommand('(ls)').reason).toBe('subshell or grouping');
    expect(analyzeBashCommand('cat <<EOF').reason).toBe('heredoc');
    expect(analyzeBashCommand('FOO=1 ls').reason).toBe('environment assignment prefix');
  });
});
