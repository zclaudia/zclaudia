import { useCallback } from 'react';
import { exportLogs, getLogCount, clearLogs } from '../../../services/logger';
import { isTauri } from '../../../utils/platform';
import { SettingsRow } from '../ui/SettingsGroup';

export function ClientLogsSection() {
  const handleExportLogs = useCallback(async () => {
    try {
      const logs = exportLogs();
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `zclaudia-logs-${ts}.json`;
      const blob = new Blob([logs], { type: 'application/json' });

      if (isTauri()) {
        const { downloadDir } = await import('@tauri-apps/api/path');
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        const dir = await downloadDir();
        const filePath = `${dir}/${fileName}`;
        await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
        if (!navigator.userAgent.includes('Android')) {
          const { open } = await import('@tauri-apps/plugin-shell');
          await open(dir);
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('[Settings] Failed to export logs:', err);
    }
  }, []);

  return (
    <SettingsRow
      align="start"
      title="Client logs"
      description={`${getLogCount()} entries in buffer`}
      control={
        <>
          <button
            onClick={() => {
              clearLogs();
            }}
            className="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg transition-colors max-md:py-2"
          >
            Clear
          </button>
          <button
            onClick={() => {
              void handleExportLogs();
            }}
            className="px-3 py-1 text-xs bg-muted/60 hover:bg-muted text-foreground rounded-lg font-medium transition-colors max-md:py-2"
          >
            Export Logs
          </button>
        </>
      }
    />
  );
}
