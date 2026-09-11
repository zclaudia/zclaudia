import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** esbuild preserves import.meta.url as the server.mjs URL in release bundles. */
export function resolveBuiltinAgentRoot(moduleUrl = import.meta.url): string {
  const filename = fileURLToPath(moduleUrl);
  if (path.basename(filename) === 'server.mjs') {
    return path.join(path.dirname(filename), 'builtin-plugins');
  }
  return path.resolve(path.dirname(filename), '../../../../plugins/agents');
}
