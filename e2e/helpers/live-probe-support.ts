import { expect, type Page } from '@playwright/test';
import { type AgentRuntimeHarness, sendCodingMessage } from './agent-runtime-harness';

export const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function withLiveDeadline<T>(
  app: AgentRuntimeHarness,
  evidence: Record<string, any>,
  turn: number,
  timeoutMs: number,
  action: () => Promise<T>
): Promise<T> {
  let shutdown: Promise<void> | undefined;
  let cleanupError: unknown;
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    evidence.timedOutTurn = turn;
    shutdown = app.stop().catch(error => {
      cleanupError = error;
    });
  }, timeoutMs);
  try {
    const result = await action();
    if (expired) throw new Error('Live turn deadline exceeded');
    return result;
  } finally {
    clearTimeout(timer);
    await shutdown;
    if (cleanupError) throw cleanupError;
  }
}

export async function liveMessagesAfter(
  app: AgentRuntimeHarness,
  sessionId: string,
  after: number
) {
  const messages: any[] = [];
  let offset = after;
  for (let batch = 0; batch < 20; batch++) {
    const result = await app.api(
      `/api/sessions/${sessionId}/messages?limit=100&afterOffset=${offset}`
    );
    messages.push(...result.messages);
    if (!result.pagination.hasMore) return messages;
    if (result.pagination.maxOffset <= offset) break;
    offset = result.pagination.maxOffset;
  }
  throw new Error('Message evidence pagination did not complete');
}

export function liveMessageSummary(messages: any[]) {
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    model: messages.find(message => message.metadata?.model)?.metadata.model ?? null,
    toolCount: messages.reduce(
      (count, message) => count + (message.metadata?.toolCalls?.length ?? 0),
      0
    ),
    reportedUsage: messages.flatMap(message => {
      const usage = message.metadata?.usage;
      return usage
        ? [
            {
              input: number(usage.input),
              output: number(usage.output),
              totalTokens: number(usage.totalTokens),
              costTotal: number(usage.cost?.total),
            },
          ]
        : [];
    }),
  };
}

// Fresh persisted messages and session state determine completion, not an exact
// vendor response string. Scenario-specific file/tool assertions follow this.
export async function runLiveUiTurn(
  page: Page,
  app: AgentRuntimeHarness,
  sessionId: string,
  prompt: string,
  timeoutMs: number,
  onApproval: () => Promise<void>,
  allowFailed = false
) {
  const previous = await app.api(`/api/sessions/${sessionId}/messages?limit=100`);
  const offset = previous.pagination.maxOffset ?? 0;
  const started = Date.now();
  await sendCodingMessage(page, prompt);
  // A rejected duplicate tap does not submit and leaves the input unchanged.
  // Fail at the UI boundary instead of waiting for a run that never started.
  await expect(page.getByTestId('message-input')).toHaveValue('');
  let approvals = 0;
  let messages: any[] = [];
  while (Date.now() - started < timeoutMs) {
    if (await page.getByRole('button', { name: 'Allow', exact: true }).count()) {
      if (++approvals > 12) throw new Error('Live approval limit exceeded');
      await onApproval();
    }
    messages = await liveMessagesAfter(app, sessionId, offset);
    if (
      !(await app.api(`/api/sessions/${sessionId}/run-state`)).isRunning &&
      messages.some(message => message.role === 'assistant' && message.content?.trim())
    )
      break;
    await pause(150);
  }
  expect((await app.api(`/api/sessions/${sessionId}/run-state`)).isRunning).toBe(false);
  expect(messages.some(message => message.role === 'assistant' && message.content?.trim())).toBe(
    true
  );
  const persisted = await app.api(`/api/sessions/${sessionId}`);
  if (!allowFailed) expect(persisted.lastRunStatus ?? null).toBeNull();
  expect(typeof persisted.sdkSessionId).toBe('string');
  expect(persisted.sdkSessionId.length).toBeGreaterThan(0);
  return {
    approvals,
    durationMs: Date.now() - started,
    sdkSessionId: persisted.sdkSessionId,
    lastRunStatus: persisted.lastRunStatus ?? null,
    ...liveMessageSummary(messages),
  };
}
