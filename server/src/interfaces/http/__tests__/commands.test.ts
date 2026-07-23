import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCommandsRoutes } from '../commands.js';

// Mock the fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Mock os module for homedir (preserve all other exports)
vi.mock('os', async importOriginal => {
  const actual = (await importOriginal()) as typeof import('os');
  return {
    ...actual,
    homedir: vi.fn(() => '/home/testuser'),
  };
});

import * as fs from 'fs';
import * as os from 'os';

// Actual (un-mocked) fs, retrieved once via importActual so the new describe
// block can use real tmp-dir operations without require().
const realFs = await vi.importActual<typeof import('fs')>('fs');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/commands', createCommandsRoutes());
  return app;
}

describe('commands routes', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe('POST /api/commands/list', () => {
    it('returns builtin and custom commands', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false); // No custom commands

      const res = await request(app).post('/api/commands/list').send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.builtin).toBeDefined();
      expect(Array.isArray(res.body.data.builtin)).toBe(true);
      expect(res.body.data.custom).toBeDefined();
      expect(res.body.data.count).toBeDefined();
    });

    it('scans project commands when projectPath provided', async () => {
      vi.mocked(fs.existsSync).mockImplementation(path => {
        return typeof path === 'string' && path.includes('/my-project/.claude/commands');
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'deploy.md', isDirectory: () => false, isFile: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.readFileSync).mockReturnValue('# Deploy Command\nDeploy to production');

      const res = await request(app)
        .post('/api/commands/list')
        .send({ projectPath: '/my-project' });

      expect(res.status).toBe(200);
      expect(res.body.data.custom.length).toBeGreaterThanOrEqual(1);
      // Verify project command is found
      const deployCmd = res.body.data.custom.find(
        (cmd: { command: string }) => cmd.command === '/deploy'
      );
      expect(deployCmd).toBeDefined();
    });

    it('scans user commands from ~/.claude/commands', async () => {
      vi.mocked(fs.existsSync).mockImplementation(path => {
        return typeof path === 'string' && path.includes('/home/testuser/.claude/commands');
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'global-cmd.md', isDirectory: () => false, isFile: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.readFileSync).mockReturnValue('# Global Command\nA global command');

      const res = await request(app).post('/api/commands/list').send({});

      expect(res.status).toBe(200);
      const globalCmd = res.body.data.custom.find(
        (cmd: { command: string }) => cmd.command === '/global-cmd'
      );
      expect(globalCmd).toBeDefined();
    });
  });

  describe('POST /api/commands/execute', () => {
    describe('builtin commands', () => {
      it('handles /clear command', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({ commandName: '/clear' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('clear');
      });

      it('handles /help command with markdown content', async () => {
        const res = await request(app).post('/api/commands/execute').send({ commandName: '/help' });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('help');
        expect(res.body.data.data.format).toBe('markdown');
        expect(res.body.data.data.content).toContain('Commands');
      });

      it('handles /status command with system info', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/status',
            context: { model: 'claude-3', provider: 'claude' },
          });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('status');
        expect(res.body.data.data.model).toBe('claude-3');
        expect(res.body.data.data.provider).toBe('claude');
        expect(res.body.data.data.platform).toBeDefined();
      });

      it('handles /model command', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/model',
            context: { model: 'claude-3-opus', provider: 'claude' },
          });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('model');
        expect(res.body.data.data.model).toBe('claude-3-opus');
      });

      it('handles /cost command with token usage', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/cost',
            context: { tokenUsage: { used: 5000, total: 100000 } },
          });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('cost');
        expect(res.body.data.data.tokenUsage.used).toBe(5000);
        expect(res.body.data.data.tokenUsage.total).toBe(100000);
        expect(res.body.data.data.tokenUsage.percentage).toBe('5.0');
      });

      it('handles /memory command', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/memory',
            context: { projectPath: '/my-project' },
          });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('memory');
        expect(res.body.data.data.path).toContain('CLAUDE.md');
        expect(res.body.data.data.exists).toBe(true);
      });

      it('handles /config command', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({ commandName: '/config' });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('config');
      });

      it('handles /new-session command', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({ commandName: '/new-session' });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('new-session');
      });

      it('handles /memory command without projectPath', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({ commandName: '/memory' });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('memory');
        expect(res.body.data.data.error).toBe(true);
      });

      it('handles /reload command', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({ commandName: '/reload' });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('reload');
        expect(res.body.data.data.message).toBe('Commands reloaded');
      });
    });

    describe('custom commands', () => {
      it('returns 400 when commandName is missing', async () => {
        const res = await request(app).post('/api/commands/execute').send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('returns 400 when commandPath missing for custom commands', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({ commandName: '/custom-cmd' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it('returns 403 for paths outside .claude/commands', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/evil-cmd',
            commandPath: '/etc/passwd',
            context: { projectPath: '/my-project' },
          });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });

      it('allows plugin command paths under .claude/plugins', async () => {
        const commandContent = '# Plugin Command\nHello from plugin.';
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(commandContent);

        const res = await request(app).post('/api/commands/execute').send({
          commandName: '/plugin-cmd',
          commandPath: '/home/testuser/.claude/plugins/foo-plugin/commands/foo.md',
          context: {},
        });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('custom');
        expect(res.body.data.content).toBe(commandContent);
      });

      it('returns 404 when command file not found', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const res = await request(app).post('/api/commands/execute').send({
          commandName: '/missing-cmd',
          commandPath: '/home/testuser/.claude/commands/missing.md',
          context: {},
        });

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('NOT_FOUND');
      });

      it('reads and processes command content', async () => {
        const commandContent = '# Test Command\nThis is a test command content.';
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(commandContent);

        const res = await request(app).post('/api/commands/execute').send({
          commandName: '/test-cmd',
          commandPath: '/home/testuser/.claude/commands/test-cmd.md',
          context: {},
        });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('custom');
        expect(res.body.data.content).toBe(commandContent);
      });

      it('replaces $ARGUMENTS placeholder', async () => {
        const commandContent = 'Run: $ARGUMENTS';
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(commandContent);

        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/run-cmd',
            commandPath: '/home/testuser/.claude/commands/run-cmd.md',
            args: ['npm', 'test'],
            context: {},
          });

        expect(res.status).toBe(200);
        expect(res.body.data.content).toBe('Run: npm test');
      });

      it('replaces $1, $2, etc. positional placeholders', async () => {
        const commandContent = 'Deploy $1 to $2';
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(commandContent);

        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/deploy-cmd',
            commandPath: '/home/testuser/.claude/commands/deploy-cmd.md',
            args: ['app', 'production'],
            context: {},
          });

        expect(res.status).toBe(200);
        expect(res.body.data.content).toBe('Deploy app to production');
      });
    });

    describe('error handling', () => {
      it('POST /api/commands/execute returns 500 when readFileSync throws', async () => {
        // existsSync returns true (passes validation), but readFileSync throws
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error('Unexpected read error');
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/custom-fail',
            commandPath: '/home/testuser/.claude/commands/fail.md',
            context: { projectPath: '/home/testuser/project' },
          });

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('SERVER_ERROR');
        errorSpy.mockRestore();
      });
    });

    describe('scanCommandsDirectory edge cases', () => {
      it('handles subdirectory scanning', async () => {
        vi.mocked(fs.existsSync).mockImplementation(p => {
          return typeof p === 'string' && p.includes('.claude/commands');
        });
        vi.mocked(fs.readdirSync).mockImplementation(dir => {
          const dirStr = String(dir);
          if (dirStr.endsWith('commands')) {
            return [
              { name: 'subdir', isDirectory: () => true, isFile: () => false },
            ] as unknown as ReturnType<typeof fs.readdirSync>;
          }
          // Subdir contents (any other directory)
          return [
            { name: 'sub-cmd.md', isDirectory: () => false, isFile: () => true },
          ] as unknown as ReturnType<typeof fs.readdirSync>;
        });
        vi.mocked(fs.readFileSync).mockReturnValue('# Sub Command\nA sub command');

        const res = await request(app).post('/api/commands/list').send({});

        expect(res.status).toBe(200);
        // The sub command should appear in custom commands
        const subCmd = res.body.data.custom.find((cmd: { command: string }) =>
          cmd.command.includes('sub-cmd')
        );
        expect(subCmd).toBeDefined();
        expect(subCmd.scope).toBe('global');
      });

      it('skips non-md files', async () => {
        vi.mocked(fs.existsSync).mockImplementation(path => {
          return typeof path === 'string' && path.includes('/home/testuser/.claude/commands');
        });
        vi.mocked(fs.readdirSync).mockReturnValue([
          { name: 'readme.txt', isDirectory: () => false, isFile: () => true },
        ] as unknown as ReturnType<typeof fs.readdirSync>);

        const res = await request(app).post('/api/commands/list').send({});

        expect(res.status).toBe(200);
        expect(res.body.data.custom).toHaveLength(0);
      });

      it('handles file read errors gracefully during scan', async () => {
        vi.mocked(fs.existsSync).mockImplementation(path => {
          return typeof path === 'string' && path.includes('/home/testuser/.claude/commands');
        });
        vi.mocked(fs.readdirSync).mockReturnValue([
          { name: 'broken.md', isDirectory: () => false, isFile: () => true },
        ] as unknown as ReturnType<typeof fs.readdirSync>);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error('Permission denied');
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const res = await request(app).post('/api/commands/list').send({});

        expect(res.status).toBe(200);
        // The broken file should be skipped gracefully
        expect(res.body.data.custom).toHaveLength(0);
        errorSpy.mockRestore();
      });

      it('handles readdirSync errors gracefully during scan', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readdirSync).mockImplementation(() => {
          throw new Error('Permission denied');
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const res = await request(app).post('/api/commands/list').send({});

        expect(res.status).toBe(200);
        // Errors during scanning should be caught gracefully
        expect(res.body.data.custom).toHaveLength(0);
        errorSpy.mockRestore();
      });
    });
  });
});

describe('POST /api/commands/execute — args + substitution', () => {
  let tmpRoot: string;
  let originalHome: string | undefined;
  let tmpHome: string;
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpRoot = realFs.mkdtempSync(path.join(tmpdir(), 'zc-cmd-'));
    tmpHome = path.join(tmpRoot, 'home');
    realFs.mkdirSync(tmpHome);
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;

    // Also update the os.homedir mock to point at our tmpHome so the route's
    // path validation allows files under tmpHome/.claude/commands.
    vi.mocked(os.homedir).mockReturnValue(tmpHome);

    // Bypass the file-level vi.mock('fs') for these tests: route real fs calls
    // through to node:fs so the commands.ts handler can readFileSync our
    // fixture files.
    vi.mocked(fs.existsSync).mockImplementation(p => realFs.existsSync(p as never));
    vi.mocked(fs.readFileSync).mockImplementation((p, enc) =>
      realFs.readFileSync(p as never, enc as never)
    );

    app = express();
    app.use(express.json());
    app.use('/api/commands', createCommandsRoutes());
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    realFs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeCustomCmd(name: string, body: string): string {
    const userCmds = path.join(tmpHome, '.claude', 'commands');
    realFs.mkdirSync(userCmds, { recursive: true });
    const filePath = path.join(userCmds, `${name}.md`);
    realFs.writeFileSync(filePath, body);
    return filePath;
  }

  it('rawArgs tokenizes with shell-style quotes via pi parseCommandArgs', async () => {
    const cmdPath = writeCustomCmd('echo', 'Args: $@');
    const res = await request(app).post('/api/commands/execute').send({
      commandName: '/echo',
      commandPath: cmdPath,
      rawArgs: 'foo "bar baz" qux',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe('Args: foo bar baz qux');
  });

  it('falls back to args[] when rawArgs is absent', async () => {
    const cmdPath = writeCustomCmd('echo2', 'Hello $1');
    const res = await request(app)
      .post('/api/commands/execute')
      .send({
        commandName: '/echo2',
        commandPath: cmdPath,
        args: ['world'],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe('Hello world');
  });

  it('falls back to args[] when rawArgs is an empty string', async () => {
    const cmdPath = writeCustomCmd('echo3', 'Hello $1');
    const res = await request(app)
      .post('/api/commands/execute')
      .send({
        commandName: '/echo3',
        commandPath: cmdPath,
        rawArgs: '',
        args: ['fallback'],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe('Hello fallback');
  });

  it('substituteArgs handles $ARGUMENTS placeholder', async () => {
    const cmdPath = writeCustomCmd('argscmd', 'Hello $ARGUMENTS');
    const res = await request(app)
      .post('/api/commands/execute')
      .send({
        commandName: '/argscmd',
        commandPath: cmdPath,
        args: ['world', 'x'],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe('Hello world x');
  });

  it('substituteArgs handles $1 $2 positional placeholders', async () => {
    const cmdPath = writeCustomCmd('poscmd', 'First $1 then $2');
    const res = await request(app)
      .post('/api/commands/execute')
      .send({
        commandName: '/poscmd',
        commandPath: cmdPath,
        args: ['a', 'b'],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe('First a then b');
  });

  it('substituteArgs handles bash-slice ${@:N:L} placeholder', async () => {
    const cmdPath = writeCustomCmd('slicecmd', 'Two: ${@:1:2}');
    const res = await request(app)
      .post('/api/commands/execute')
      .send({
        commandName: '/slicecmd',
        commandPath: cmdPath,
        args: ['a', 'b', 'c', 'd'],
      });
    expect(res.status).toBe(200);
    // pi substituteArgs joins sliced args with spaces; the body must contain a and b but not c
    expect(res.body.data.content).toContain('a');
    expect(res.body.data.content).toContain('b');
    expect(res.body.data.content).not.toContain('c');
  });

  it('path traversal guard still rejects out-of-base commandPath', async () => {
    const outsidePath = path.join(tmpRoot, 'outside.md');
    realFs.writeFileSync(outsidePath, '# Not allowed');
    const res = await request(app).post('/api/commands/execute').send({
      commandName: '/evil',
      commandPath: outsidePath,
      args: [],
    });
    expect(res.status).toBe(403);
  });

  it('accepts an in-base file whose name starts with ".." (e.g. ..data.md)', async () => {
    // Regression: the boundary check must only reject `..` itself or `..<sep>…`
    // escapes, not legitimate in-base names that merely start with two dots.
    const cmdPath = writeCustomCmd('..data', '# Dot Dot Data');
    const res = await request(app).post('/api/commands/execute').send({
      commandName: '/dotdot',
      commandPath: cmdPath,
      args: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe('# Dot Dot Data');
  });

  it('legacy: args path still works when no rawArgs provided (regression check)', async () => {
    const cmdPath = writeCustomCmd('legacy', '$ARGUMENTS done');
    const res = await request(app)
      .post('/api/commands/execute')
      .send({
        commandName: '/legacy',
        commandPath: cmdPath,
        args: ['hello', 'world'],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe('hello world done');
  });
});
