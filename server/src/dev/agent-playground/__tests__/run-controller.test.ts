import { describe, expect, it, vi } from 'vitest';
import type { ExternalAgentAdapter } from '@zclaudia/shared/providers';
import type { AgentPlaygroundServerMessage } from '@zclaudia/shared/plugins/agent-playground';
import { PlaygroundRunController } from '../run-controller.js';

function waitFor(predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > 2000) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for controller event'));
      }
    }, 5);
  });
}

describe('PlaygroundRunController', () => {
  it('streams adapter events and publishes completion', async () => {
    const adapter: ExternalAgentAdapter = {
      type: 'fixture',
      async *run() {
        yield { type: 'init', sessionId: 'provider-session' };
        yield { type: 'assistant_delta', content: 'hello' };
        yield { type: 'provider_turn_finished', isComplete: true };
      },
    };
    const messages: AgentPlaygroundServerMessage[] = [];
    const controller = new PlaygroundRunController({
      getAdapter: () => adapter,
      broadcast: message => messages.push(message),
    });

    const { runId } = controller.start({
      input: 'hi',
      cwd: process.cwd(),
      permissionPolicy: 'deny',
    });

    await waitFor(() => messages.some(message => message.type === 'run_finished'));
    expect(
      messages.some(
        message =>
          message.type === 'runtime_event' &&
          message.runId === runId &&
          message.event.type === 'assistant_delta'
      )
    ).toBe(true);
    expect(messages.find(message => message.type === 'run_finished')).toMatchObject({
      runId,
      sessionId: 'provider-session',
      aborted: false,
    });
  });

  it('bridges an interactive permission decision', async () => {
    const messages: AgentPlaygroundServerMessage[] = [];
    let decision: unknown;
    const adapter: ExternalAgentAdapter = {
      type: 'fixture',
      async *run(_input, _context, onPermission) {
        decision = await onPermission({
          requestId: 'permission-1',
          toolName: 'Bash',
          toolInput: { command: 'pwd' },
          detail: 'Run pwd',
          timeoutSeconds: 30,
        });
        yield { type: 'provider_turn_finished', isComplete: true };
      },
    };
    const controller = new PlaygroundRunController({
      getAdapter: () => adapter,
      broadcast: message => messages.push(message),
    });

    controller.start({ input: 'hi', cwd: process.cwd(), permissionPolicy: 'prompt' });
    await waitFor(() => messages.some(message => message.type === 'permission_request'));
    expect(controller.resolvePermission({ requestId: 'permission-1', behavior: 'allow' })).toBe(
      true
    );
    await waitFor(() => messages.some(message => message.type === 'run_finished'));
    expect(decision).toEqual({ behavior: 'allow', updatedInput: undefined, message: undefined });
  });

  it('records automatically resolved permission requests in the event stream', async () => {
    const messages: AgentPlaygroundServerMessage[] = [];
    let decision: unknown;
    const adapter: ExternalAgentAdapter = {
      type: 'fixture',
      async *run(_input, _context, onPermission) {
        decision = await onPermission({
          requestId: 'permission-1',
          toolName: 'Bash',
          toolInput: { command: 'pwd' },
          detail: 'Run pwd',
          timeoutSeconds: 30,
        });
        yield { type: 'provider_turn_finished', isComplete: true };
      },
    };
    const controller = new PlaygroundRunController({
      getAdapter: () => adapter,
      broadcast: message => messages.push(message),
    });

    controller.start({ input: 'hi', cwd: process.cwd(), permissionPolicy: 'deny' });
    await waitFor(() => messages.some(message => message.type === 'run_finished'));

    expect(decision).toMatchObject({ behavior: 'deny' });
    expect(messages.map(message => message.type)).toContain('permission_request');
    expect(messages.map(message => message.type)).toContain('permission_resolved');
  });

  it('aborts through both the controller and adapter', async () => {
    const abort = vi.fn(async () => {});
    const adapter: ExternalAgentAdapter = {
      type: 'fixture',
      abort,
      async *run(_input, context) {
        yield { type: 'init', sessionId: 'provider-session' };
        await new Promise<void>(resolve => {
          context.abortController?.signal.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
      },
    };
    const messages: AgentPlaygroundServerMessage[] = [];
    const controller = new PlaygroundRunController({
      getAdapter: () => adapter,
      broadcast: message => messages.push(message),
    });

    const { runId } = controller.start({ input: 'hi', cwd: process.cwd() });
    await waitFor(() => messages.some(message => message.type === 'runtime_event'));
    expect(await controller.abort(runId)).toBe(true);
    await waitFor(() => messages.some(message => message.type === 'run_finished'));
    expect(abort).toHaveBeenCalledWith('provider-session', process.cwd());
  });

  it('waits for active generators to finish before abortAll resolves', async () => {
    let generatorFinished = false;
    const adapter: ExternalAgentAdapter = {
      type: 'fixture',
      async *run(_input, context) {
        yield { type: 'init', sessionId: 'provider-session' };
        await new Promise<void>(resolve => {
          context.abortController?.signal.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
        await new Promise(resolve => setTimeout(resolve, 10));
        generatorFinished = true;
      },
    };
    const messages: AgentPlaygroundServerMessage[] = [];
    const controller = new PlaygroundRunController({
      getAdapter: () => adapter,
      broadcast: message => messages.push(message),
    });

    controller.start({ input: 'hi', cwd: process.cwd() });
    await waitFor(() => messages.some(message => message.type === 'runtime_event'));
    await controller.abortAll();

    expect(generatorFinished).toBe(true);
    expect(controller.activeRunIds).toEqual([]);
    expect(messages.at(-1)?.type).toBe('run_finished');
  });
});
