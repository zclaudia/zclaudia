import { ClaudeAgentAdapter } from '../src/infra/providers/claude-agent/adapter.js';
import type { ProviderRuntimeEvent } from '../src/infra/providers/types.js';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /abort|cancel/i.test(`${error.name} ${error.message}`);
}

async function collect(
  adapter: ClaudeAgentAdapter,
  input: string,
  options: {
    cwd: string;
    sessionId?: string;
    abortAfterMs?: number;
  }
): Promise<{
  events: ProviderRuntimeEvent[];
  sessionId?: string;
  aborted: boolean;
  abortObserved: boolean;
  elapsedMs: number;
}> {
  const startedAt = Date.now();
  const abortController = new AbortController();
  const timer =
    options.abortAfterMs !== undefined
      ? setTimeout(() => abortController.abort(), options.abortAfterMs)
      : undefined;
  const events: ProviderRuntimeEvent[] = [];

  try {
    for await (const event of adapter.run(
      input,
      {
        cwd: options.cwd,
        sessionId: options.sessionId,
        claudiaSessionId: `smoke-${Date.now()}`,
        abortController,
        mode: 'default',
      } as never,
      async () => ({ behavior: 'deny', message: 'Smoke test denies permission prompts.' })
    )) {
      events.push(event);
      if (event.type === 'init' && event.sessionId) {
        console.log(`[smoke] init session=${event.sessionId}`);
      }
      if (event.type === 'assistant' && event.content) {
        console.log(`[smoke] assistant ${event.content.slice(0, 120)}`);
      }
      if (event.type === 'result') {
        console.log('[smoke] result');
      }
      if (event.type === 'error') {
        console.error(`[smoke] provider error: ${event.error}`);
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted || !isAbortLikeError(error)) {
      throw error;
    }
    console.log('[smoke] abort observed');
    return {
      events,
      sessionId: events.find(event => event.type === 'init' && event.sessionId)?.sessionId,
      aborted: true,
      abortObserved: true,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }

  return {
    events,
    sessionId: events.find(event => event.type === 'init' && event.sessionId)?.sessionId,
    aborted: abortController.signal.aborted,
    abortObserved: false,
    elapsedMs: Date.now() - startedAt,
  };
}

function stoppedPromptlyAfterAbort(
  result: Awaited<ReturnType<typeof collect>>,
  abortAfterMs: number
): boolean {
  return (
    result.aborted &&
    (result.abortObserved ||
      (result.elapsedMs <= abortAfterMs + 5_000 &&
        !result.events.some(event => event.type === 'result')))
  );
}

async function main(): Promise<void> {
  if (!hasFlag('live')) {
    console.log('Skipping live Claude smoke. Re-run with --live to call the Claude Agent SDK.');
    return;
  }

  const cwd = arg('cwd') ?? process.cwd();
  const prompt = arg('prompt') ?? 'Reply with exactly: zclaudia claude runtime smoke ok';
  const adapter = new ClaudeAgentAdapter();

  const first = await collect(adapter, prompt, { cwd });
  if (!first.sessionId) {
    throw new Error('Claude smoke did not receive an init session id.');
  }
  if (!first.events.some(event => event.type === 'result' || event.type === 'assistant')) {
    throw new Error('Claude smoke did not receive assistant content or a result event.');
  }

  const second = await collect(adapter, 'Reply with exactly: resumed ok', {
    cwd,
    sessionId: first.sessionId,
  });
  if (second.sessionId !== first.sessionId) {
    throw new Error(
      `Claude resume smoke started a different session: ${second.sessionId ?? 'missing init'}`
    );
  }
  if (!second.events.some(event => event.type === 'result' || event.type === 'assistant')) {
    throw new Error('Claude resume smoke did not receive assistant content or a result event.');
  }

  const abortAfterMs = 250;
  const cancelled = await collect(adapter, 'Wait for 30 seconds before replying.', {
    cwd,
    sessionId: first.sessionId,
    abortAfterMs,
  });
  if (!stoppedPromptlyAfterAbort(cancelled, abortAfterMs)) {
    throw new Error('Claude cancel smoke did not stop promptly after AbortController fired.');
  }
  console.log('[smoke] cancel path invoked through AbortController');
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
