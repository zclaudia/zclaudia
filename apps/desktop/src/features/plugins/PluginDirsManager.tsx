import { useState, useEffect, useCallback } from 'react';
import { getBaseUrl, fetchAndSyncPlugins } from '../../services/api';

// Plugin directory manager
export function PluginDirsManager({ embedded = false }: { embedded?: boolean } = {}) {
  const [extraDirs, setExtraDirs] = useState<string[]>([]);
  const [allDirs, setAllDirs] = useState<string[]>([]);
  const [newDir, setNewDir] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(!embedded);

  const fetchDirs = useCallback(async () => {
    try {
      const baseUrl = getBaseUrl();
      const res = await fetch(`${baseUrl}/api/plugins/dirs`);
      const data = await res.json();
      if (data.success) {
        setAllDirs(data.data.dirs);
        setExtraDirs(data.data.extraDirs);
      }
    } catch {
      // Silently fail on load
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDirs();
  }, [fetchDirs]);

  const saveDirs = async (dirs: string[]) => {
    setError(null);
    try {
      const baseUrl = getBaseUrl();
      const res = await fetch(`${baseUrl}/api/plugins/dirs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirs }),
      });
      const data = await res.json();
      if (data.success) {
        setAllDirs(data.data.dirs);
        setExtraDirs(dirs);
        // Refresh plugin list after directory change.
        // Server discovers and activates plugins asynchronously, so delay slightly.
        setTimeout(() => fetchAndSyncPlugins().catch(() => {}), 500);
      } else {
        setError(data.error?.message || 'Failed to save');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  const handleAdd = () => {
    const trimmed = newDir.trim();
    if (!trimmed || extraDirs.includes(trimmed)) return;
    saveDirs([...extraDirs, trimmed]);
    setNewDir('');
  };

  const handleRemove = (dir: string) => {
    saveDirs(extraDirs.filter(d => d !== dir));
  };

  if (loading) return null;

  const defaultDirs = allDirs.filter(d => !extraDirs.includes(d));

  return (
    <div>
      {!embedded && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground tracking-wider mb-2 hover:text-foreground transition-colors"
        >
          <svg
            className={`w-3 h-3 transition-transform ${collapsed ? '' : 'rotate-90'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Plugin directories ({allDirs.length})
        </button>
      )}

      {!collapsed && (
        <div className="space-y-2">
          {/* Directory list */}
          <div className="bg-muted rounded-lg p-2 space-y-1">
            {/* Default dirs (read-only) */}
            {defaultDirs.map(dir => (
              <div
                key={dir}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-xs font-mono text-muted-foreground"
              >
                <span className="flex-1 truncate">{dir}</span>
                <span className="text-xs text-muted-foreground/50 shrink-0">default</span>
              </div>
            ))}

            {/* Extra dirs (removable) */}
            {extraDirs.map(dir => (
              <div
                key={dir}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-xs font-mono text-foreground bg-secondary/50"
              >
                <span className="flex-1 truncate">{dir}</span>
                <button
                  onClick={() => handleRemove(dir)}
                  className="p-1 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  title="Remove directory"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Add new */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="/path/to/plugins"
              value={newDir}
              onChange={e => setNewDir(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              className="flex-1 px-3 py-2 bg-input border border-border rounded-lg text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
            <button
              onClick={handleAdd}
              disabled={!newDir.trim()}
              className="px-4 py-2 bg-muted/60 hover:bg-muted text-foreground text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Add
            </button>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <p className="text-xs text-muted-foreground">
            Plugins in added directories are scanned automatically.
          </p>
        </div>
      )}
    </div>
  );
}
