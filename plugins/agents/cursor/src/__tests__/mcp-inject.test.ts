import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { externalizeBridgeEnv, injectCursorMcpBridge } from '../mcp-inject.js';

describe('injectCursorMcpBridge', () => {
  const dirs: string[] = [];
  afterEach(() => {
    // leave tmp dirs; OS cleans. Track for clarity.
    dirs.length = 0;
  });

  function project(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'zclaudia-cursor-mcp-'));
    dirs.push(dir);
    return dir;
  }

  it('creates .cursor/mcp.json and writes the bridge server', () => {
    const cwd = project();
    const result = injectCursorMcpBridge(cwd, {
      name: 'claudia-plugins',
      config: { command: 'node', args: ['bridge.js'] },
    });
    expect(result).toMatchObject({
      ok: true,
      injected: true,
      injectedNames: ['claudia-plugins'],
    });
    const raw = JSON.parse(readFileSync(path.join(cwd, '.cursor', 'mcp.json'), 'utf8'));
    expect(raw.mcpServers['claudia-plugins']).toEqual({
      command: 'node',
      args: ['bridge.js'],
    });
  });

  it('merges without removing existing servers', () => {
    const cwd = project();
    mkdirSync(path.join(cwd, '.cursor'), { recursive: true });
    writeFileSync(
      path.join(cwd, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { docs: { command: 'docs' } } })
    );
    injectCursorMcpBridge(cwd, {
      name: 'claudia-plugins',
      config: { command: 'node', args: ['bridge.js'] },
    });
    const raw = JSON.parse(readFileSync(path.join(cwd, '.cursor', 'mcp.json'), 'utf8'));
    expect(raw.mcpServers.docs).toEqual({ command: 'docs' });
    expect(raw.mcpServers['claudia-plugins']).toBeTruthy();
  });

  it('does not overwrite a user server with the same name', () => {
    const cwd = project();
    mkdirSync(path.join(cwd, '.cursor'), { recursive: true });
    writeFileSync(
      path.join(cwd, '.cursor', 'mcp.json'),
      JSON.stringify({
        mcpServers: { 'claudia-plugins': { command: 'user-bridge' } },
      })
    );
    const result = injectCursorMcpBridge(cwd, {
      name: 'claudia-plugins',
      config: { command: 'node', args: ['bridge.js'] },
    });
    expect(result).toMatchObject({ ok: true, injected: false, injectedNames: [] });
    const raw = JSON.parse(readFileSync(path.join(cwd, '.cursor', 'mcp.json'), 'utf8'));
    expect(raw.mcpServers['claudia-plugins']).toEqual({ command: 'user-bridge' });
  });

  it('recovers from invalid JSON by rewriting a fresh config', () => {
    const cwd = project();
    mkdirSync(path.join(cwd, '.cursor'), { recursive: true });
    writeFileSync(path.join(cwd, '.cursor', 'mcp.json'), '{not-json');
    const result = injectCursorMcpBridge(cwd, {
      name: 'claudia-plugins',
      config: { command: 'node', args: ['bridge.js'] },
    });
    expect(result).toMatchObject({ ok: true, injected: true });
    expect(existsSync(path.join(cwd, '.cursor', 'mcp.json'))).toBe(true);
  });

  it('removes a newly created bridge config during cleanup', () => {
    const cwd = project();
    const result = injectCursorMcpBridge(cwd, {
      name: 'agent-dev-tools',
      config: { command: 'node', args: ['bridge.js'] },
    });
    expect(result).toMatchObject({ ok: true, injected: true });
    if (!result.ok) return;
    expect(existsSync(path.join(cwd, '.cursor', 'mcp.json'))).toBe(true);
    result.cleanup();
    expect(existsSync(path.join(cwd, '.cursor', 'mcp.json'))).toBe(false);
  });

  it('restores an existing config during cleanup', () => {
    const cwd = project();
    const configPath = path.join(cwd, '.cursor', 'mcp.json');
    mkdirSync(path.dirname(configPath), { recursive: true });
    const original = `${JSON.stringify({ mcpServers: { docs: { command: 'docs' } } }, null, 2)}\n`;
    writeFileSync(configPath, original);
    const result = injectCursorMcpBridge(cwd, {
      name: 'agent-dev-tools',
      config: { command: 'node', args: ['bridge.js'] },
    });
    if (!result.ok) throw new Error(result.reason);
    result.cleanup();
    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });
});

describe('externalizeBridgeEnv', () => {
  it('replaces every env value with a placeholder and returns the real values', () => {
    const { bridge, env } = externalizeBridgeEnv({
      name: 'claudia-plugins',
      config: {
        command: 'node',
        args: ['bridge.js'],
        env: {
          AGENT_TOOL_BRIDGE_TOKEN: 's3cret',
          AGENT_TOOL_BRIDGE_URL: 'http://127.0.0.1:51234',
        },
      },
    });

    expect((bridge.config as { env: Record<string, string> }).env).toEqual({
      AGENT_TOOL_BRIDGE_TOKEN: '${ZCLAUDIA_CURSOR_BRIDGE_AGENT_TOOL_BRIDGE_TOKEN}',
      AGENT_TOOL_BRIDGE_URL: '${ZCLAUDIA_CURSOR_BRIDGE_AGENT_TOOL_BRIDGE_URL}',
    });
    expect(env).toEqual({
      ZCLAUDIA_CURSOR_BRIDGE_AGENT_TOOL_BRIDGE_TOKEN: 's3cret',
      ZCLAUDIA_CURSOR_BRIDGE_AGENT_TOOL_BRIDGE_URL: 'http://127.0.0.1:51234',
    });
  });

  it('never writes a secret value into the config it returns', () => {
    const { bridge } = externalizeBridgeEnv({
      name: 'claudia-plugins',
      config: { command: 'node', env: { AGENT_TOOL_BRIDGE_TOKEN: 'top-secret-token' } },
    });
    expect(JSON.stringify(bridge.config)).not.toContain('top-secret-token');
  });

  it('produces a config that is stable across runs with rotating values', () => {
    const make = (token: string, port: number) =>
      externalizeBridgeEnv({
        name: 'claudia-plugins',
        config: {
          command: 'node',
          env: {
            AGENT_TOOL_BRIDGE_TOKEN: token,
            AGENT_TOOL_BRIDGE_URL: `http://127.0.0.1:${port}`,
          },
        },
      }).bridge.config;
    expect(make('a', 1)).toEqual(make('b', 2));
  });

  it('sanitizes env keys that are not valid variable characters', () => {
    const { bridge, env } = externalizeBridgeEnv({
      name: 'b',
      config: { env: { 'weird.key-name': 'v' } },
    });
    expect((bridge.config as { env: Record<string, string> }).env['weird.key-name']).toBe(
      '${ZCLAUDIA_CURSOR_BRIDGE_WEIRD_KEY_NAME}'
    );
    expect(env.ZCLAUDIA_CURSOR_BRIDGE_WEIRD_KEY_NAME).toBe('v');
  });

  it('passes through configs with no env block untouched', () => {
    const config = { command: 'node', args: ['bridge.js'] };
    const { bridge, env } = externalizeBridgeEnv({ name: 'b', config });
    expect(bridge.config).toEqual(config);
    expect(env).toEqual({});
  });

  it('tolerates a non-object config', () => {
    const { bridge, env } = externalizeBridgeEnv({ name: 'b', config: 'not-an-object' });
    expect(bridge.config).toBe('not-an-object');
    expect(env).toEqual({});
  });

  it('leaves non-string env values in place rather than dropping them', () => {
    const { bridge, env } = externalizeBridgeEnv({
      name: 'b',
      config: { env: { KEEP: 42 as unknown as string, SECRET: 'x' } },
    });
    const out = (bridge.config as { env: Record<string, unknown> }).env;
    expect(out.KEEP).toBe(42);
    expect(out.SECRET).toBe('${ZCLAUDIA_CURSOR_BRIDGE_SECRET}');
    expect(env).toEqual({ ZCLAUDIA_CURSOR_BRIDGE_SECRET: 'x' });
  });
});
