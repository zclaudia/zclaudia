// Deterministic fake ACP agent used by the Cursor plugin's protocol tests.
//
// Speaks real JSON-RPC over NDJSON stdio (no SDK) and is driven entirely by
// FAKE_ACP_MODE, so tests exercise the production AcpClient/AcpRunner stack
// through a genuine child process instead of function mocks. Optionally
// records the wire traffic (requests it received + permission responses it
// observed) to FAKE_ACP_RECORD as JSON lines.
import { writeFileSync, appendFileSync } from 'fs';
import { createInterface } from 'readline';

const MODE = process.env.FAKE_ACP_MODE ?? 'happy';
const RECORD = process.env.FAKE_ACP_RECORD;
const send = msg => {
  if (process.env.FAKE_ACP_DEBUG)
    appendFileSync(process.env.FAKE_ACP_DEBUG, `[send] ${JSON.stringify(msg).slice(0, 250)}\n`);
  process.stdout.write(JSON.stringify(msg) + '\n');
};
const recv = msg => {
  if (process.env.FAKE_ACP_DEBUG)
    appendFileSync(process.env.FAKE_ACP_DEBUG, `[recv] ${JSON.stringify(msg).slice(0, 250)}\n`);
};
const record = [];

let buffer = '';
let promptRequestId;
const CLIENT_HANDLERS = [];

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  recv(msg);
  dispatch(msg);
});

function dispatch(msg) {
  const { id, method, params } = msg;

  // Client → agent responses (permission replies, extension replies).
  if (id !== undefined && method === undefined) {
    for (const handler of CLIENT_HANDLERS.splice(0)) {
      if (handler.matches(id)) {
        handler.receive(msg.result ?? msg.error);
        return;
      }
    }
    record.push({ clientResponseFor: id, result: msg.result, error: msg.error });
    flushRecord();
    return;
  }

  switch (method) {
    case 'initialize':
      record.push({ method, params });
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true },
          authMethods: [{ id: 'cursor_login', name: 'Cursor Login' }],
        },
      });
      return;
    case 'authenticate':
      record.push({ method, params });
      send({ jsonrpc: '2.0', id, result: {} });
      return;
    case 'session/new':
      record.push({ method, params });
      send({
        jsonrpc: '2.0',
        id,
        result: {
          sessionId: 'fake-session-1',
          modes:
            MODE === 'mode-unsupported'
              ? {
                  currentModeId: 'agent',
                  availableModes: [
                    { id: 'agent', name: 'Agent' },
                    { id: 'ask', name: 'Ask' },
                  ],
                }
              : {
                  currentModeId: 'agent',
                  availableModes: [
                    { id: 'agent', name: 'Agent' },
                    { id: 'plan', name: 'Plan' },
                    { id: 'ask', name: 'Ask' },
                  ],
                },
          models: {
            currentModelId: 'default[]',
            availableModels: [
              { modelId: 'default[]', name: 'Auto' },
              { modelId: 'fake-model[thinking=true,context=9k]', name: 'fake-model' },
            ],
          },
        },
      });
      return;
    case 'session/load':
      record.push({ method, params });
      if (MODE === 'load-not-found' || params.sessionId !== 'fake-session-1') {
        send({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: 'Invalid params',
            data: { message: `Session "${params.sessionId}" not found` },
          },
        });
        return;
      }
      if (MODE === 'load-replay') {
        send(
          update({
            sessionUpdate: 'user_message_chunk',
            content: { type: 'text', text: 'old question' },
          })
        );
        send(
          update({
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'old thought' },
          })
        );
        send(
          update({
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'old answer' },
          })
        );
      }
      send({ jsonrpc: '2.0', id, result: {} });
      return;
    case 'session/set_mode':
      record.push({ method, params });
      send({ jsonrpc: '2.0', id, result: {} });
      return;
    case 'session/set_model':
      record.push({ method, params });
      send({ jsonrpc: '2.0', id, result: {} });
      return;
    case 'session/cancel':
      record.push({ method, params });
      if (MODE === 'hang') {
        send({ jsonrpc: '2.0', id: promptRequestId, result: { stopReason: 'cancelled' } });
      }
      // `ignore-cancel` deliberately does not settle session/prompt so the
      // client-side cancellation grace/close ladder is exercised.
      return;
    case 'session/prompt':
      record.push({ method, params });
      promptRequestId = id;
      if (MODE === 'hang' || MODE === 'ignore-cancel') return;
      runPromptBehavior();
      return;
    default:
      if (id !== undefined) send({ jsonrpc: '2.0', id, result: {} });
  }
}

function runPromptBehavior() {
  switch (MODE) {
    case 'deny-completed': {
      toolCall('t1', 'Bash', 'execute');
      send(permissionRequest('t1', 'Bash'));
      // Even after the client rejects, the agent still reports completed (§9.2).
      send(
        update({
          sessionUpdate: 'tool_call_update',
          toolCallId: 't1',
          status: 'completed',
          rawOutput: { success: true },
        })
      );
      endTurn();
      return;
    }
    case 'mcp-placeholder': {
      // §9.1 placeholder pair: bare tool_call first, identity in the update.
      send(
        update({
          sessionUpdate: 'tool_call',
          toolCallId: 'm1',
          title: 'MCP: tool',
          kind: 'other',
          status: 'pending',
          rawInput: {},
        })
      );
      send(
        update({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'm1',
          title: 'zclaudia-probe: probe_ping',
          rawInput: { providerIdentifier: 'zclaudia-probe', toolName: 'probe_ping', args: {} },
        })
      );
      send(update({ sessionUpdate: 'tool_call_update', toolCallId: 'm1', status: 'in_progress' }));
      send(permissionRequest('m1', 'zclaudia-probe: probe_ping'));
      send(
        update({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'm1',
          status: 'completed',
          rawOutput: { success: true },
        })
      );
      send(
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done' } })
      );
      endTurn();
      return;
    }
    case 'bypass-allow': {
      toolCall('b1', 'Bash', 'execute');
      send(permissionRequest('b1', 'Bash'));
      endTurn();
      return;
    }
    case 'never-permitted': {
      // Mutating tool runs to completion without any permission request (§8.3).
      send(
        update({
          sessionUpdate: 'tool_call',
          toolCallId: 'v1',
          title: 'Edit',
          kind: 'edit',
          status: 'pending',
          rawInput: {},
        })
      );
      send(update({ sessionUpdate: 'tool_call_update', toolCallId: 'v1', status: 'in_progress' }));
      send(
        update({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'v1',
          status: 'completed',
          rawOutput: {},
        })
      );
      endTurn();
      return;
    }
    case 'load-replay': {
      send(
        update({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'fresh answer' },
        })
      );
      endTurn();
      return;
    }
    case 'model-check': {
      endTurn();
      return;
    }
    case 'ask-skip': {
      sendAskQuestion();
      return;
    }
    case 'create-plan': {
      sendCreatePlan();
      return;
    }
    default: {
      send(
        update({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hello world' },
        })
      );
      endTurn();
    }
  }
}

// Blocking extension requests initiated BY the agent: register how the reply
// continues the turn, then send the request.
function sendAskQuestion() {
  CLIENT_HANDLERS.push({
    matches: responseId => responseId === 'ask-1',
    receive: result => {
      record.push({ askQuestionResult: result });
      flushRecord();
      const outcome = result?.outcome?.outcome ?? JSON.stringify(result);
      send(
        update({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `ASK:${outcome}` },
        })
      );
      endTurn();
    },
  });
  send({
    jsonrpc: '2.0',
    id: 'ask-1',
    method: 'cursor/ask_question',
    params: {
      toolCallId: 'q1',
      questions: [{ id: 'q', prompt: 'pick one', options: [{ id: 'a', label: 'A' }] }],
    },
  });
}

function sendCreatePlan() {
  CLIENT_HANDLERS.push({
    matches: responseId => responseId === 'plan-1',
    receive: result => {
      const outcome = result?.outcome?.outcome ?? JSON.stringify(result);
      record.push({ createPlanOutcome: outcome, createPlanResult: result });
      flushRecord();
      send(
        update({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `PLAN:${outcome}` },
        })
      );
      endTurn();
    },
  });
  send({
    jsonrpc: '2.0',
    id: 'plan-1',
    method: 'cursor/create_plan',
    params: {
      toolCallId: 'p1',
      name: 'The Plan',
      overview: 'Overview',
      plan: '# Plan\n1. Do it',
      todos: [{ id: 'todo-1', content: 'Do it', status: 'pending' }],
    },
  });
}

function toolCall(id, title, kind) {
  send(
    update({
      sessionUpdate: 'tool_call',
      toolCallId: id,
      title,
      kind,
      status: 'pending',
      rawInput: { command: 'echo hi' },
    })
  );
  send(update({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'in_progress' }));
}

function permissionRequest(toolCallId, title) {
  return {
    jsonrpc: '2.0',
    id: `perm-${toolCallId}`,
    method: 'session/request_permission',
    params: {
      sessionId: 'fake-session-1',
      toolCall: {
        toolCallId,
        kind: 'execute',
        title,
        status: 'in_progress',
        rawInput: { command: 'echo hi' },
        content: [{ type: 'content', content: { type: 'text', text: 'Not in allowlist: echo' } }],
      },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    },
  };
}

function update(u) {
  return {
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId: 'fake-session-1', update: u },
  };
}

function endTurn() {
  send({ jsonrpc: '2.0', id: promptRequestId, result: { stopReason: 'end_turn' } });
}

function flushRecord() {
  if (!RECORD) return;
  try {
    writeFileSync(RECORD, record.map(entry => JSON.stringify(entry)).join('\n'));
  } catch {
    /* best effort */
  }
}

// Flush the record periodically so tests can read it while we run.
setInterval(flushRecord, 100).unref();
process.on('disconnect', () => {
  flushRecord();
  process.exit(0);
});
process.on('exit', flushRecord);
