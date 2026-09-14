import { execFile } from 'node:child_process';
import { promisify, stripVTControlCharacters } from 'node:util';
import type { ExternalAgentRunContext } from '@zclaudia/plugin-sdk/providers';
import { resolveCursorCliFromPath } from './resolve-cli.js';

const execFileAsync = promisify(execFile);

/** Legacy sessions use the CLI catalog, whose IDs can be passed to --model. */
export function parseCliModels(output: string) {
  const models: Array<{ id: string; label: string; thinkingLevels: string[] }> = [];
  const seen = new Set<string>();
  let currentModel: string | undefined;
  let defaultModel: string | undefined;
  for (const line of stripVTControlCharacters(output).split(/\r?\n/)) {
    const match = line.trim().match(/^(.+?) - (.+)$/);
    if (!match) continue;
    const [, id, description] = match;
    if (seen.has(id)) continue;
    seen.add(id);
    if (/\(current\)$/.test(description)) currentModel = id;
    if (/\(default\)$/.test(description)) defaultModel = id;
    models.push({
      id,
      label: description.replace(/\s+\((?:current|default)\)$/, ''),
      thinkingLevels: [],
    });
  }
  if (!models.length) throw new Error('Cursor did not return a model catalog');
  return { models, currentModel: currentModel ?? defaultModel };
}

export async function discoverCliModels(context: ExternalAgentRunContext, signal: AbortSignal) {
  signal.throwIfAborted();
  const binary =
    context.cliPath ||
    resolveCursorCliFromPath(context.env?.PATH ?? process.env.PATH) ||
    'cursor-agent';
  const { stdout } = await execFileAsync(binary, ['--list-models'], {
    cwd: context.cwd,
    env: { ...process.env, ...context.env, NO_COLOR: '1' },
    signal,
    timeout: 12_000,
    maxBuffer: 1024 * 1024,
    encoding: 'utf8',
  });
  return parseCliModels(stdout);
}
