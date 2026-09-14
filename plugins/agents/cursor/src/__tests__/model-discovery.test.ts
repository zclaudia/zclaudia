import { describe, expect, it, vi } from 'vitest';
import { parseCliModels, discoverCliModels } from '../model-discovery.js';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => execute(...args) }));

describe('Cursor CLI model discovery', () => {
  it('reads decorated output and preserves complete variant IDs', () => {
    const result = parseCliModels(
      '\u001b[1mAvailable models\u001b[0m\r\n\nauto - Auto (default)\ncomposer - Composer (current)\nopus[effort=high,context=1m] - Opus (1M context)\ncomposer - Composer\n\nTip: use --model <id>'
    );
    expect(result).toEqual({
      currentModel: 'composer',
      models: [
        { id: 'auto', label: 'Auto', thinkingLevels: [] },
        { id: 'composer', label: 'Composer', thinkingLevels: [] },
        { id: 'opus[effort=high,context=1m]', label: 'Opus (1M context)', thinkingLevels: [] },
      ],
    });
  });
  it('rejects empty or unrecognized output', () => {
    expect(() => parseCliModels('Login required')).toThrow('model catalog');
    expect(() => parseCliModels('')).toThrow('model catalog');
  });
  it('uses the configured CLI without resuming or prompting', async () => {
    execute.mockImplementationOnce((_binary, _args, _options, callback) =>
      callback(null, { stdout: 'auto - Auto (default)' })
    );
    const signal = new AbortController().signal;
    const catalog = await discoverCliModels(
      { cwd: '/project', cliPath: '/custom/cursor', sessionId: 'existing' },
      signal
    );
    expect(catalog.currentModel).toBe('auto');
    expect(execute).toHaveBeenCalledWith(
      '/custom/cursor',
      ['--list-models'],
      expect.objectContaining({ cwd: '/project', signal, timeout: 12000 }),
      expect.any(Function)
    );
  });
  it('does not spawn when already cancelled', async () => {
    execute.mockClear();
    await expect(discoverCliModels({ cwd: '/project' }, AbortSignal.abort())).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
