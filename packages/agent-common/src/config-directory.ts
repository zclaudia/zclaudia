import { homedir } from 'node:os';
import path from 'node:path';

/** Optional isolated provider settings root for embedded hosts and test accounts. */
export function agentConfigDirectory(provider: string): string {
  const root = process.env.ZCLAUDIA_AGENT_CONFIG_ROOT;
  return root ? path.join(path.resolve(root), provider) : path.join(homedir(), `.${provider}`);
}
