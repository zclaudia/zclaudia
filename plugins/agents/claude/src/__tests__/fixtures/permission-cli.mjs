// Model-free CLI control-protocol fixture, exercised through the real SDK.
import { createInterface } from 'node:readline';

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const result = () => send({ type: 'result', subtype: 'success', result: 'done' });
let inputClosed = false;
let toolIndex = 0;
const tools = ['AskUserQuestion', 'ExitPlanMode'];

function requestTool() {
  const name = tools[toolIndex];
  const id = `tool-${toolIndex}`;
  const input = name === 'AskUserQuestion' ? { questions: [] } : { plan: '# Plan' };
  send({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name, input }] },
  });
  if (inputClosed) {
    send({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: id,
            is_error: true,
            content: 'Tool permission request failed: AbortError: Stream closed',
          },
        ],
      },
    });
    result();
    return;
  }
  send({
    type: 'control_request',
    request_id: id,
    request: { subtype: 'can_use_tool', tool_name: name, tool_use_id: id, input },
  });
}

const lines = createInterface({ input: process.stdin });
lines.on('close', () => {
  inputClosed = true;
});
lines.on('line', line => {
  const message = JSON.parse(line);
  if (message.type === 'control_request') {
    send({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: message.request_id,
        response: { commands: [], models: [], account: {} },
      },
    });
  } else if (message.type === 'user') {
    send({ type: 'system', subtype: 'init', session_id: 'fixture-session' });
    if (message.message.content === 'foreground') {
      result();
      return;
    }
    send({ type: 'system', subtype: 'task_started', task_id: 'background-1' });
    result();
    // Give the SDK time to act on the first result before the continuation.
    setTimeout(() => {
      send({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'background-1',
        status: 'completed',
      });
      requestTool();
    }, 40);
  } else if (message.type === 'control_response') {
    send({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: `tool-${toolIndex}`,
            content: message.response.response?.message ?? 'approved',
          },
        ],
      },
    });
    toolIndex++;
    if (toolIndex < tools.length) requestTool();
    else result();
  }
});
