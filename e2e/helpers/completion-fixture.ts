import { createServer } from 'node:http';

export interface CompletionRequest {
  model: string;
  stream: boolean;
  messages: Array<{ role: string; content?: unknown; tool_call_id?: string }>;
  tools?: Array<{ function: { name: string } }>;
}
export type CompletionAnswer =
  | { content: string }
  | { tool: string; arguments: Record<string, unknown> };

/** Only the upstream model boundary is scripted; host routing and tools stay real. */
export async function startCompletionFixture(
  answer: (request: CompletionRequest) => CompletionAnswer
) {
  const requests: CompletionRequest[] = [];
  const errors: string[] = [];
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions')
        throw new Error(`Unexpected fixture request: ${req.method} ${req.url}`);
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as CompletionRequest;
      requests.push(body);
      if (!body.stream) throw new Error('Expected streaming model request');
      const result = answer(body);
      const id = `fixture-${requests.length}`;
      const delta =
        'content' in result
          ? { content: result.content }
          : {
              tool_calls: [
                {
                  index: 0,
                  id: `call-${id}`,
                  type: 'function',
                  function: {
                    name: result.tool,
                    arguments: JSON.stringify(result.arguments),
                  },
                },
              ],
            };
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const emit = (delta: unknown, finishReason: string | null) =>
        res.write(
          `data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created: 1,
            model: body.model,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`
        );
      emit({ role: 'assistant' }, null);
      emit(delta, null);
      emit({}, 'content' in result ? 'stop' : 'tool_calls');
      res.end('data: [DONE]\n\n');
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: errors.at(-1) } }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture has no TCP address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    errors,
    async stop() {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Model fixture did not close')), 5000);
        server.close(error => {
          clearTimeout(timeout);
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}
