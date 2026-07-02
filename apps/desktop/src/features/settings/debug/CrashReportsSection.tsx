import { useState, useEffect, useCallback } from 'react';
import * as api from '../../../services/api';
import type { CrashReportEntry } from '../../../services/api/debug';
import { SettingsRow } from '../ui/SettingsGroup';

export function CrashReportsSection({ embeddedServerStatus }: { embeddedServerStatus: string }) {
  const [crashReports, setCrashReports] = useState<CrashReportEntry[]>([]);
  const [crashReportsPath, setCrashReportsPath] = useState<string | null>(null);
  const [crashReportsLoading, setCrashReportsLoading] = useState(false);
  const [crashReportsError, setCrashReportsError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadCrashReports = useCallback(async () => {
    setCrashReportsLoading(true);
    setCrashReportsError(null);
    try {
      const result = await api.getCrashReports();
      setCrashReports(result.reports);
      setCrashReportsPath(result.filePath);
    } catch (err) {
      setCrashReports([]);
      setCrashReportsPath(null);
      setCrashReportsError(err instanceof Error ? err.message : 'Failed to load crash reports');
    } finally {
      setCrashReportsLoading(false);
    }
  }, []);

  const handleCopyJSON = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(crashReports, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[Settings] Failed to copy crash reports:', err);
    }
  }, [crashReports]);

  useEffect(() => {
    if (embeddedServerStatus === 'disabled') return;
    void loadCrashReports();
  }, [embeddedServerStatus, loadCrashReports]);

  return (
    <SettingsRow
      align="start"
      title="Crash reports"
      description="Recent embedded server fatal crashes stored on disk."
      control={
        <>
          <button
            onClick={() => {
              void loadCrashReports();
            }}
            disabled={crashReportsLoading || embeddedServerStatus === 'disabled'}
            className="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 disabled:bg-muted disabled:text-muted-foreground text-secondary-foreground rounded-lg transition-colors"
          >
            {crashReportsLoading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={() => {
              void handleCopyJSON();
            }}
            disabled={crashReports.length === 0}
            className="px-2 py-1 text-xs bg-muted/60 hover:bg-muted disabled:bg-muted disabled:text-muted-foreground text-foreground rounded-lg transition-colors"
          >
            {copied ? 'Copied!' : 'Copy JSON'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {crashReportsPath && (
          <div className="text-[11px] text-muted-foreground break-all">{crashReportsPath}</div>
        )}
        {crashReportsError && <div className="text-xs text-destructive">{crashReportsError}</div>}
        {!crashReportsError && crashReports.length === 0 && !crashReportsLoading && (
          <div className="text-xs text-muted-foreground">No crash reports recorded.</div>
        )}
        {crashReports.length > 0 && (
          <div className="space-y-2">
            {crashReports.map(report => (
              <div key={report.id} className="p-3 bg-secondary/40 rounded-md space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-medium">{report.event}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(report.ts).toLocaleString()}
                  </div>
                </div>
                <div className="text-xs break-words">{report.message}</div>
                <div className="text-[11px] text-muted-foreground">
                  v{report.version} • pid {report.pid} • {report.platform}
                </div>
                {report.stack && (
                  <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-card px-2 py-1.5 text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
                    {report.stack}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingsRow>
  );
}
