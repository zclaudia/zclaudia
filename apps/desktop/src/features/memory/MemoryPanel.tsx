import { useEffect, useState } from 'react';
import { getProjectMemoryDir } from '../../services/api/memory';
import { listDirectory, getFileContent } from '../../services/api/files';
import { useOwnershipStore } from '../../stores/ownershipStore';
import type { FileEntry } from '@zclaudia/shared';

interface MemoryPanelProps {
  projectId?: string;
  backendId?: string | null;
}

interface DetailView {
  name: string;
  content: string | null;
  loading: boolean;
  error: string | null;
}

export function MemoryPanel({ projectId, backendId: propBackendId }: MemoryPanelProps) {
  const resolvedBackendId = useOwnershipStore(
    (s) => propBackendId ?? (projectId ? s.getProjectBackendId(projectId) : null),
  );

  const [memoryDir, setMemoryDir] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<DetailView | null>(null);

  useEffect(() => {
    if (!projectId) {
      setMemoryDir(null);
      setEntries([]);
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    (async () => {
      try {
        const { memoryDir: dir } = await getProjectMemoryDir({ projectId, backendId: resolvedBackendId });
        const listing = await listDirectory({ projectRoot: dir, maxResults: 200, backendId: resolvedBackendId });
        if (cancelled) return;
        setMemoryDir(dir);
        setEntries((listing.entries ?? []).filter((e) => e.type !== 'directory'));
      } catch {
        if (!cancelled) {
          setMemoryDir(null);
          setEntries([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, resolvedBackendId]);

  function openDetail(entry: FileEntry) {
    if (!memoryDir) return;
    setDetail({ name: entry.name, content: null, loading: true, error: null });
    getFileContent({ projectRoot: memoryDir, relativePath: entry.name, backendId: resolvedBackendId })
      .then((res) => setDetail((prev) => prev && prev.name === entry.name ? { ...prev, content: res.content, loading: false } : prev))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load file';
        setDetail((prev) => prev && prev.name === entry.name ? { ...prev, loading: false, error: msg } : prev);
      });
  }

  if (loading) {
    return <div className="p-4 text-sm opacity-60">Loading…</div>;
  }

  if (detail) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-2 pt-2 pb-1 border-b border-black/10 dark:border-white/10">
          <button
            type="button"
            className="text-xs px-2 py-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5 opacity-70 hover:opacity-100"
            onClick={() => setDetail(null)}
          >
            ← Back
          </button>
          <span className="text-xs font-medium truncate">{detail.name}</span>
        </div>
        <div className="flex-1 overflow-auto p-2">
          {detail.loading && <div className="text-sm opacity-60">Loading…</div>}
          {detail.error && <div className="text-sm text-red-500">{detail.error}</div>}
          {!detail.loading && !detail.error && detail.content !== null && (
            <pre className="text-xs whitespace-pre-wrap break-words">{detail.content}</pre>
          )}
        </div>
      </div>
    );
  }

  if (!projectId || !memoryDir || entries.length === 0) {
    return (
      <div className="p-4 text-sm opacity-60">
        No memories yet — the agent saves project memory here as it works.
      </div>
    );
  }

  return (
    <div className="p-2">
      <ul>
        {entries.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              className="w-full text-left px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-sm"
              onClick={() => openDetail(entry)}
            >
              {entry.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
