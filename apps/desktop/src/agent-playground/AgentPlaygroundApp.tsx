import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Activity,
  AlertTriangle,
  Bot,
  Braces,
  CheckCircle2,
  CircleStop,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Terminal,
  User,
  Wrench,
  XCircle,
} from 'lucide-react';
import type {
  AgentPlaygroundPermissionPolicy,
  AgentPlaygroundRunRequest,
} from '@zclaudia/shared/plugins/agent-playground';
import { Badge } from '../components/ui/Badge';
import { Button, IconButton } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import {
  agentPlaygroundReducer,
  initialAgentPlaygroundState,
  type PlaygroundMessage,
  type PlaygroundToolCall,
} from './state';
import { agentPlaygroundApi, connectAgentPlayground } from './transport';

const FIELD =
  'w-full rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary';
type PlaygroundThinkingLevel = NonNullable<AgentPlaygroundRunRequest['thinkingLevel']>;

function JsonValue({ value }: { value: unknown }) {
  if (value === undefined) return null;
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-background/70 p-2 font-mono text-[10px] leading-4 text-muted-foreground">
      {text}
    </pre>
  );
}

function ToolCard({ tool }: { tool: PlaygroundToolCall }) {
  const StatusIcon =
    tool.status === 'running' ? Loader2 : tool.status === 'error' ? XCircle : CheckCircle2;
  return (
    <div className="rounded-lg border border-border/70 bg-secondary/30 p-2.5">
      <div className="flex items-center gap-2">
        <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-mono text-xs">{tool.name}</span>
        <StatusIcon
          className={`ml-auto h-3.5 w-3.5 ${
            tool.status === 'running'
              ? 'animate-spin text-primary'
              : tool.status === 'error'
                ? 'text-destructive'
                : 'text-success'
          }`}
        />
      </div>
      <JsonValue value={tool.input} />
      {tool.status !== 'running' && <JsonValue value={tool.result} />}
    </div>
  );
}

function MessageCard({
  message,
  tools,
}: {
  message: PlaygroundMessage;
  tools: PlaygroundToolCall[];
}) {
  const isUser = message.role === 'user';
  return (
    <article className={`flex gap-3 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot className="h-4 w-4" />
        </span>
      )}
      <div
        className={`min-w-0 max-w-[82%] rounded-xl border px-3 py-2.5 ${
          isUser ? 'border-primary/20 bg-primary/10' : 'border-border/70 bg-card shadow-apple-sm'
        }`}
      >
        {message.thinking && (
          <details className="mb-2 rounded-lg border border-thinking/20 bg-thinking/5 p-2 text-xs">
            <summary className="cursor-pointer text-thinking">Thinking</summary>
            <div className="mt-2 whitespace-pre-wrap text-muted-foreground">{message.thinking}</div>
          </details>
        )}
        {message.content ? (
          <div className="prose prose-sm max-w-none break-words text-sm text-foreground dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        ) : !isUser && !message.error ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for output…
          </div>
        ) : null}
        {tools.length > 0 && (
          <div className="mt-3 space-y-2">
            {tools.map(tool => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}
        {message.error && (
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {message.error}
          </div>
        )}
      </div>
      {isUser && (
        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <User className="h-4 w-4" />
        </span>
      )}
    </article>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function AgentPlaygroundApp() {
  const [state, dispatch] = useReducer(agentPlaygroundReducer, initialAgentPlaygroundState);
  const [cwd, setCwd] = useState('');
  const [cliPath, setCliPath] = useState('');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState<PlaygroundThinkingLevel | ''>('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [permissionPolicy, setPermissionPolicy] =
    useState<AgentPlaygroundPermissionPolicy>('prompt');
  const [input, setInput] = useState('');
  const [inspector, setInspector] = useState<'events' | 'logs' | 'capabilities'>('events');
  const [reloading, setReloading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      connectAgentPlayground(
        message => dispatch({ type: 'server', message }),
        connected => dispatch({ type: 'connection', connected })
      ),
    []
  );

  useEffect(() => {
    void agentPlaygroundApi
      .status()
      .then(status => {
        dispatch({ type: 'status_loaded', status });
        setCwd(current => current || status.defaultCwd);
        const firstMode = Object.values(status.runtime.manifest.permissionModeMap ?? {})[0];
        if (firstMode) setMode(current => current || firstMode);
      })
      .catch(error =>
        dispatch({ type: 'error', error: error instanceof Error ? error.message : String(error) })
      );
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages, state.tools, state.permissions]);

  const modeOptions = useMemo(() => {
    const entries = Object.entries(state.status?.runtime.manifest.permissionModeMap ?? {});
    return entries.length > 0
      ? entries.map(([label, value]) => ({
          value,
          label: label.replaceAll('_', ' '),
        }))
      : [{ value: 'default', label: 'default' }];
  }, [state.status]);

  const activeRunId = state.activeRunIds.at(-1);
  const running = Boolean(activeRunId);
  const busy = submitting || running;
  const runtime = state.status?.runtime;

  const submit = async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    const request: AgentPlaygroundRunRequest = {
      input: trimmed,
      cwd,
      sessionId: state.sessionId,
      cliPath: cliPath.trim() || undefined,
      model: model.trim() || undefined,
      mode: mode || undefined,
      thinkingLevel: thinkingLevel || undefined,
      systemPrompt: systemPrompt.trim() || undefined,
      permissionPolicy,
    };
    setSubmitting(true);
    try {
      await agentPlaygroundApi.run(request);
      setInput('');
    } catch (error) {
      dispatch({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    } finally {
      setSubmitting(false);
    }
  };

  const reload = async () => {
    setReloading(true);
    try {
      const status = await agentPlaygroundApi.reload();
      dispatch({ type: 'status_loaded', status });
    } catch (error) {
      dispatch({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    } finally {
      setReloading(false);
    }
  };

  const decidePermission = async (
    requestId: string,
    behavior: 'allow' | 'deny',
    message?: string
  ) => {
    try {
      await agentPlaygroundApi.decidePermission({ requestId, behavior, message });
    } catch (error) {
      dispatch({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  };

  const changeMode = (next: string) => {
    setMode(next);
    if (!state.sessionId) return;
    void agentPlaygroundApi.setMode(state.sessionId, next).catch(error => {
      dispatch({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    });
  };

  const abortRun = (runId: string) => {
    void agentPlaygroundApi.abort(runId).catch(error => {
      dispatch({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    });
  };

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Play className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">Agent Playground</h1>
          <p className="truncate text-[10px] text-muted-foreground">
            {state.status
              ? `${state.status.plugin.name} · ${state.status.runtime.type}`
              : 'Connecting to Dev Host…'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {state.sessionId && <Badge label={`session ${state.sessionId.slice(0, 8)}`} />}
          <Badge
            label={state.connected ? 'Connected' : 'Disconnected'}
            tone={state.connected ? 'success' : 'neutral'}
            online={state.connected}
          />
          <IconButton
            aria-label="Reload plugin"
            onClick={() => void reload()}
            disabled={reloading || busy}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${reloading ? 'animate-spin' : ''}`} />
          </IconButton>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[240px_minmax(360px,1fr)_320px]">
        <aside className="overflow-y-auto border-r border-border bg-[hsl(var(--sidebar))] p-3">
          <div className="mb-3 flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
            <h2 className="text-xs font-medium">Runtime settings</h2>
          </div>
          <div className="space-y-3">
            <LabeledField label="Working directory">
              <input className={FIELD} value={cwd} onChange={event => setCwd(event.target.value)} />
            </LabeledField>
            <LabeledField label="CLI path">
              <input
                className={`${FIELD} font-mono`}
                value={cliPath}
                onChange={event => setCliPath(event.target.value)}
                placeholder="Use PATH"
              />
            </LabeledField>
            <LabeledField label="Model">
              <input
                className={FIELD}
                value={model}
                onChange={event => setModel(event.target.value)}
                placeholder="Runtime default"
              />
            </LabeledField>
            <LabeledField label="Mode">
              <Select
                value={mode || modeOptions[0]?.value || ''}
                onChange={changeMode}
                options={modeOptions}
                block
                size="md"
              />
            </LabeledField>
            <LabeledField label="Thinking level">
              <Select
                value={thinkingLevel}
                onChange={next => setThinkingLevel(next as PlaygroundThinkingLevel | '')}
                options={[
                  { value: '', label: 'Auto' },
                  { value: 'off', label: 'Off' },
                  { value: 'minimal', label: 'Minimal' },
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                  { value: 'xhigh', label: 'XHigh' },
                ]}
                block
                size="md"
              />
            </LabeledField>
            <LabeledField label="Permission handling">
              <Select
                value={permissionPolicy}
                onChange={setPermissionPolicy}
                options={[
                  { value: 'prompt', label: 'Prompt in UI' },
                  { value: 'allow', label: 'Auto allow' },
                  { value: 'deny', label: 'Auto deny' },
                ]}
                block
                size="md"
              />
            </LabeledField>
            <LabeledField label="System prompt">
              <textarea
                className={`${FIELD} min-h-24 resize-y`}
                value={systemPrompt}
                onChange={event => setSystemPrompt(event.target.value)}
                placeholder="Optional"
              />
            </LabeledField>
          </div>
          <div className="mt-4 space-y-2 border-t border-border pt-3">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => dispatch({ type: 'new_session' })}
              disabled={busy}
            >
              <RotateCcw className="h-3.5 w-3.5" /> New session
            </Button>
            {!state.status?.toolBridgeAvailable && (
              <p className="text-[10px] leading-4 text-muted-foreground">
                Claudia MCP bridge is disabled. Provider-native tools remain available.
              </p>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col bg-background">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {state.messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Bot className="h-6 w-6" />
                </span>
                <h2 className="text-sm font-medium">
                  {runtime?.label ?? 'Agent'} is ready to test
                </h2>
                <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                  Send a prompt to exercise the real plugin adapter. Events, tool calls and
                  permission requests appear live.
                </p>
              </div>
            ) : (
              state.messages.map(message => (
                <MessageCard
                  key={message.id}
                  message={message}
                  tools={state.tools.filter(tool => tool.runId === message.runId)}
                />
              ))
            )}

            {state.permissions.map(({ runId, request }) => (
              <div
                key={request.requestId}
                className="mx-auto max-w-xl rounded-xl border border-warning/30 bg-warning/10 p-3"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs font-medium">
                      Permission required · {request.toolName}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">{request.detail}</p>
                    <JsonValue value={request.toolInput} />
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() =>
                          void decidePermission(request.requestId, 'deny', `Denied in run ${runId}`)
                        }
                      >
                        Deny
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => void decidePermission(request.requestId, 'allow')}
                      >
                        Allow
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {state.error && (
            <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">{state.error}</span>
              <button onClick={() => dispatch({ type: 'error', error: undefined })}>×</button>
            </div>
          )}

          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 shadow-apple-sm focus-within:ring-1 focus-within:ring-primary">
              <textarea
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                placeholder={`Message ${runtime?.label ?? 'agent'}…`}
                rows={2}
                className="min-h-10 flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none"
              />
              {running ? (
                <Button variant="destructive" onClick={() => activeRunId && abortRun(activeRunId)}>
                  <CircleStop className="h-3.5 w-3.5" /> Stop
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => void submit()}
                  disabled={!input.trim() || !state.connected || submitting}
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}{' '}
                  Send
                </Button>
              )}
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-l border-border bg-[hsl(var(--sidebar))]">
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
            {(
              [
                ['events', Activity],
                ['logs', Terminal],
                ['capabilities', Braces],
              ] as const
            ).map(([key, Icon]) => (
              <button
                key={key}
                onClick={() => setInspector(key)}
                className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] capitalize ${
                  inspector === key
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {key}
              </button>
            ))}
            <IconButton
              aria-label="Clear inspector"
              size="sm"
              className="ml-auto"
              onClick={() => dispatch({ type: 'clear_inspector' })}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <div className="flex-1 overflow-auto p-3">
            {inspector === 'events' &&
              (state.events.length === 0 ? (
                <p className="text-xs text-muted-foreground">No events yet.</p>
              ) : (
                <div className="space-y-2">
                  {state.events
                    .slice()
                    .reverse()
                    .map((event, index) => (
                      <details
                        key={`${event.timestamp}-${index}`}
                        className="rounded-lg border border-border/60 bg-card/60 p-2"
                      >
                        <summary className="cursor-pointer font-mono text-[10px]">
                          {event.type}
                        </summary>
                        <JsonValue value={event} />
                      </details>
                    ))}
                </div>
              ))}
            {inspector === 'logs' &&
              (state.logs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No plugin logs yet.</p>
              ) : (
                <div className="space-y-1.5 font-mono text-[10px]">
                  {state.logs.map((log, index) => (
                    <div
                      key={`${log.timestamp}-${index}`}
                      className={`rounded-md px-2 py-1.5 ${
                        log.level === 'error'
                          ? 'bg-destructive/10 text-destructive'
                          : log.level === 'warn'
                            ? 'bg-warning/10 text-warning'
                            : 'bg-secondary/40 text-muted-foreground'
                      }`}
                    >
                      [{log.level}] {log.message}
                    </div>
                  ))}
                </div>
              ))}
            {inspector === 'capabilities' && (
              <JsonValue value={state.status?.runtime ?? { status: 'Loading…' }} />
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
