import * as path from 'path';
import { resolveDataDir } from '../domains/tasks/executors/command-executor.js';

/** Per-project memory directory: <dataDir>/memory/<projectId> */
export function resolveProjectMemoryDir(projectId: string): string {
  return path.join(resolveDataDir(), 'memory', projectId);
}
