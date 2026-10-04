import { useEffect, useRef, useState } from 'react';
import { Braces } from 'lucide-react';
import type {
  LanguageServerState,
  LanguageServerStatusEntry,
  SessionLanguageServers,
} from '@zclaudia/shared/core/language-servers';
import { getSessionLanguageServers } from '../../services/api';
import { CopyableCommand } from '../../components/ui/CopyableCommand';
import { HoverPopover } from '../../components/ui/HoverPopover';
import { SECTION_LABEL } from '../../components/ui/typography';
import { TONE_DOT, type Tone } from '../../components/ui/tone';

/** Fast while something is changing, slow once settled. */
const POLL_CHANGING_MS = 2_000;
const POLL_SETTLED_MS = 15_000;

const STATE_TONE: Record<LanguageServerState, Tone> = {
  idle: 'neutral',
  starting: 'warning',
  stopped: 'warning',
  ready: 'success',
  failed: 'destructive',
  // Not faults: the user can act on them. No warning color.
  missing: 'neutral',
  needs_permission: 'neutral',
};

// Which state the single trigger dot shows when servers disagree.
const STATE_PRIORITY: LanguageServerState[] = [
  'failed',
  'stopped',
  'starting',
  'ready',
  'idle',
  'missing',
  'needs_permission',
];

function stateLabel(server: LanguageServerStatusEntry): string {
  switch (server.state) {
    case 'ready':
      return `Ready · ${server.openDocuments} open file${server.openDocuments === 1 ? '' : 's'}`;
    case 'starting':
      return 'Starting…';
    case 'stopped':
      return 'Crashed, restarting';
    case 'failed':
      return 'Failed';
    case 'idle':
      return 'Not running';
    case 'missing':
      return 'Not installed';
    case 'needs_permission':
      return 'Needs permission';
  }
}

function overallState(servers: LanguageServerStatusEntry[]): LanguageServerState {
  return STATE_PRIORITY.find(state => servers.some(s => s.state === state)) ?? 'idle';
}

/**
 * Composer-footer indicator of the language servers this session's agent can
 * use (ZClaudia runtime only): a monochrome icon whose status dot is the only
 * color, with a hover popover listing each server's state and last error.
 * Renders nothing when no server applies, so most sessions never see it.
 */
export function LanguageServerIndicator({
  sessionId,
  runActive = false,
}: {
  sessionId: string;
  /** A run is in progress: it leases (and so starts) the servers. */
  runActive?: boolean;
}) {
  // Mounted with key={sessionId}, so state never outlives its session.
  const [data, setData] = useState<SessionLanguageServers | null>(null);
  // Lets the popover ask the running poll loop for an immediate refresh.
  const refreshNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Ask again at `delay` when the window is visible; a hidden window waits
    // an extra settled interval first, so background tabs stay quiet.
    const repoll = (delay: number) => {
      timer = setTimeout(
        () => {
          if (document.visibilityState === 'visible') void refresh();
          else timer = setTimeout(() => void refresh(), POLL_SETTLED_MS);
        },
        delay
      );
    };

    const refresh = async () => {
      clearTimeout(timer);
      // An older backend without the endpoint, or offline: show nothing.
      const next = await getSessionLanguageServers(sessionId).catch(() => null);
      if (cancelled) return;
      if (!next) {
        // Keep polling: a one-off fetch failure must not hide the indicator
        // for the rest of the session in a window that never loses focus.
        repoll(POLL_SETTLED_MS);
        return;
      }
      setData(next);
      if (!next?.applicable || !next.enabled || next.servers.length === 0) return;
      // A run starts idle servers, so keep watching them closely while it lasts.
      const changing = next.servers.some(
        s => s.state === 'starting' || s.state === 'stopped' || (runActive && s.state === 'idle')
      );
      repoll(changing ? POLL_CHANGING_MS : POLL_SETTLED_MS);
    };

    refreshNow.current = () => void refresh();
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
    // Re-run (refreshing at once) when a run starts or ends.
  }, [sessionId, runActive]);

  if (!data?.applicable || !data.enabled || data.servers.length === 0) return null;

  const overall = overallState(data.servers);
  const summary = data.servers.map(s => `${s.name}: ${stateLabel(s)}`).join(', ');

  return (
    <HoverPopover
      onOpen={() => refreshNow.current()}
      panelTestId="language-server-popover"
      content={<LanguageServerPanel servers={data.servers} />}
    >
      <button
        type="button"
        data-testid="language-server-indicator"
        data-state={overall}
        aria-label={`Language servers — ${summary}`}
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Braces size={14} strokeWidth={1.75} />
        <span
          className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${TONE_DOT[STATE_TONE[overall]]}`}
        />
      </button>
    </HoverPopover>
  );
}

function LanguageServerPanel({ servers }: { servers: LanguageServerStatusEntry[] }) {
  return (
    <>
      <div className="space-y-2 px-3 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <Braces size={14} strokeWidth={1.75} className="flex-shrink-0 text-muted-foreground" />
          <span className={SECTION_LABEL}>Language servers</span>
          <span className="ml-auto text-muted-foreground">This workspace</span>
        </div>
        <ul className="space-y-1.5">
          {servers.map(server => (
            <li key={server.id} data-testid="language-server-row">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${TONE_DOT[STATE_TONE[server.state]]}`}
                />
                <span className="text-foreground/90">{server.name}</span>
                <span className="ml-auto text-muted-foreground">{stateLabel(server)}</span>
              </div>
              {server.lastError && (server.state === 'failed' || server.state === 'stopped') && (
                <p className="mt-0.5 break-words pl-4 text-2xs text-destructive">
                  {server.lastError}
                </p>
              )}
              {server.lastError &&
                (server.state === 'missing' || server.state === 'needs_permission') && (
                  <p className="mt-0.5 break-words pl-4 text-2xs text-muted-foreground">
                    {server.state === 'needs_permission'
                      ? 'Allow it in Settings → Claudia → Language servers'
                      : server.lastError}
                  </p>
                )}
              {server.installHint && (
                <div className="mt-1 pl-4">
                  <CopyableCommand command={server.installHint} />
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          Checks errors after each edit · answers LSPTool queries
        </p>
      </div>
      <div className="border-t border-border/40 px-3 py-2 text-3xs text-muted-foreground">
        Starts on first use · stops after 10 min idle
      </div>
    </>
  );
}
