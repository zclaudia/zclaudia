import { useEffect } from 'react';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import * as api from '../../services/api';

/**
 * How often to poll the server for external file changes while a file is open.
 * The panel runs a single setInterval; on each tick it stats the file and only
 * re-fetches full content when the mtime advanced. The first check also fires
 * immediately on open/switch so a stale cached view is corrected right away.
 */
const FILE_POLL_INTERVAL_MS = 5000;

interface FileContentPollingParams {
  filePath: string | null;
  projectRoot: string;
  backendId: string | null | undefined;
  visible: boolean;
  setContent: (content: string, mtimeMs?: number) => void;
  setError: (error: string | null) => void;
}

/**
 * Freshness poll: on open/switch and every FILE_POLL_INTERVAL_MS, stat the
 * current file and re-fetch full content only when the mtime advanced past what we
 * already show. This picks up edits made by the agent *or* by any external
 * process (editor, git pull, …) while the viewer is open. Cached content is
 * shown instantly and updated seamlessly in the background once the new
 * version arrives — no "Loading…" flicker for refreshes.
 *
 * Retained workspace panels stop polling when hidden; target changes cancel
 * in-flight work so a previous root or file cannot overwrite the new viewer.
 */
export function useFileContentPolling({
  filePath,
  projectRoot,
  backendId,
  visible,
  setContent,
  setError,
}: FileContentPollingParams): void {
  useEffect(() => {
    if (!filePath || !projectRoot || !visible) return;

    let cancelled = false;
    // Scope the guard to this target/effect. A cancelled request must not block
    // the immediate load after a file switch or StrictMode effect restart.
    let pollInFlight = false;
    const isCurrentTarget = () => {
      const current = useFileViewerStore.getState();
      return !cancelled && current.filePath === filePath && (!current.projectRoot || current.projectRoot === projectRoot) &&
        (!current.backendId || current.backendId === backendId);
    };

    const checkOnce = async () => {
      if (cancelled || pollInFlight) return;
      // Skip work while the whole window is hidden (background tab).
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      pollInFlight = true;
      try {
        const st = useFileViewerStore.getState();
        // Bail if the user has since switched to a different file. (A project
        // switch re-runs this effect via its props with a fresh closure + cleanup,
        // so only the file path needs guarding here.)
        if (!isCurrentTarget()) return;
        const hasContent = st.content != null;
        const knownMtime = st.knownMtimeMs;

        // Stat first (cheap). If we already have content and the mtime hasn't
        // advanced, there is nothing to do.
        let stat;
        try {
          stat = await api.getFileStat({
            projectRoot,
            relativePath: filePath,
            backendId,
          });
        } catch (e) {
          // Stat failed (deleted / network). Only surface an error when there is
          // no cached content to keep showing.
          if (!hasContent && isCurrentTarget()) {
            setError(e instanceof Error ? e.message : 'Failed to load file');
          }
          return;
        }
        if (!isCurrentTarget()) return;
        if (hasContent && knownMtime != null && stat.mtimeMs <= knownMtime) return;

        // Stale or first load: fetch the full content.
        const result = await api.getFileContent({
          projectRoot,
          relativePath: filePath,
          backendId,
        });
        if (!isCurrentTarget()) return;
        setContent(result.content, stat.mtimeMs);
      } catch (e) {
        if (isCurrentTarget() && useFileViewerStore.getState().content == null) {
          setError(e instanceof Error ? e.message : 'Failed to load file');
        }
      } finally {
        pollInFlight = false;
      }
    };

    // Fire once immediately (covers the "open/switch" trigger) then poll.
    void checkOnce();
    const intervalId = window.setInterval(() => void checkOnce(), FILE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [backendId, filePath, projectRoot, setContent, setError, visible]);
}
