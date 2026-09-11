import type { PluginContext } from '@zclaudia/plugin-sdk/runtime';
import { registerAgentRuntime } from '@zclaudia/agent-common';
import { CodexAgentAdapter } from './adapter.js';
import { destroyAllCodexClients } from './runner.js';

export async function activate(context: PluginContext): Promise<void> {
  registerAgentRuntime(context, 'codex', bridge => new CodexAgentAdapter(bridge));
}

export async function deactivate(): Promise<void> {
  await destroyAllCodexClients();
}
