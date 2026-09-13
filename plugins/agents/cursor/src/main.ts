import type { PluginContext } from '@zclaudia/plugin-sdk/runtime';
import { registerAgentRuntime } from '@zclaudia/agent-common';
import { CursorAgentAdapter } from './adapter.js';
import { destroyAllCursorProcesses } from './runner.js';
import { destroyAllAcpProcesses } from './acp-client.js';

export async function activate(context: PluginContext): Promise<void> {
  registerAgentRuntime(context, 'cursor', bridge => new CursorAgentAdapter(bridge));
}

export async function deactivate(): Promise<void> {
  await destroyAllCursorProcesses();
  await destroyAllAcpProcesses();
}
