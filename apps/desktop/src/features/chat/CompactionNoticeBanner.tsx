import { useSessionConfigStore } from '../../stores/sessionConfigStore';

export function CompactionNoticeBanner({ sessionId }: { sessionId: string }) {
  const notice = useSessionConfigStore((s) => s.compactionNotice[sessionId]);
  const clear = useSessionConfigStore((s) => s.clearCompactionNotice);
  if (!notice?.breakerOpen) return null;
  return (
    <div className="mx-3 my-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs flex items-start gap-2">
      <span className="flex-1">
        Context is full and auto-compaction keeps failing, so it's paused. Run <code>/compact</code> or start a new session to continue.
      </span>
      <button type="button" className="opacity-60 hover:opacity-100" onClick={() => clear(sessionId)} aria-label="Dismiss">×</button>
    </div>
  );
}
