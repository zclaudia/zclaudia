import { useEffect, useState } from 'react';
import { getProjectMemoryDir } from '../../services/api/memory';
import { listDirectory } from '../../services/api/files';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import type { FileEntry } from '@zclaudia/shared';

interface MemoryPanelProps {
  projectId?: string;
  backendId?: string | null;
}

export function MemoryPanel({ projectId, backendId }: MemoryPanelProps) {
  const [memoryDir, setMemoryDir] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const openFile = useFileViewerStore((s) => s.openFile);

  useEffect(() => {
    if (!projectId) {
      setMemoryDir(null);
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { memoryDir: dir } = await getProjectMemoryDir({ projectId, backendId });
        const listing = await listDirectory({ projectRoot: dir, maxResults: 200, backendId });
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
  }, [projectId, backendId]);

  if (loading) {
    return <div className="p-4 text-sm opacity-60">Loading…</div>;
  }

  if (!projectId || !memoryDir || entries.length === 0) {
    return (
      <div className="p-4 text-sm opacity-60">
        暂无记忆 — agent 会在工作中沉淀项目记忆到这里。
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
              onClick={() => openFile(memoryDir, entry.name)}
            >
              {entry.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
