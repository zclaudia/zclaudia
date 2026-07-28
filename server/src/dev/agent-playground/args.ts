import { randomBytes } from 'node:crypto';
import path from 'node:path';

export interface AgentPlaygroundArgs {
  pluginPath: string;
  runtime?: string;
  port: number;
  token: string;
  defaultCwd: string;
  watch: boolean;
}

function nextValue(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

export function parseAgentPlaygroundArgs(
  argv: string[],
  workingDirectory = process.cwd()
): AgentPlaygroundArgs {
  let pluginPath = '';
  let runtime: string | undefined;
  let port = 4310;
  let token = '';
  let defaultCwd = workingDirectory;
  let watch = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--plugin':
        pluginPath = nextValue(argv, index, arg);
        index += 1;
        break;
      case '--runtime':
        runtime = nextValue(argv, index, arg);
        index += 1;
        break;
      case '--port':
        port = Number(nextValue(argv, index, arg));
        index += 1;
        break;
      case '--token':
        token = nextValue(argv, index, arg);
        index += 1;
        break;
      case '--cwd':
        defaultCwd = nextValue(argv, index, arg);
        index += 1;
        break;
      case '--no-watch':
        watch = false;
        break;
      default:
        throw new Error(`Unknown Agent Playground option: ${arg}`);
    }
  }

  if (!pluginPath) throw new Error('--plugin is required');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --port value: ${port}`);
  }

  return {
    pluginPath: path.resolve(workingDirectory, pluginPath),
    runtime,
    port,
    token: token || randomBytes(24).toString('hex'),
    defaultCwd: path.resolve(workingDirectory, defaultCwd),
    watch,
  };
}
