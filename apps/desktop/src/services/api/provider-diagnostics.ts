import { apiCall } from './unwrap';

export type DeferredDiagnostic = {
  path?: string;
  line?: number;
  column?: number;
  severity?: 'error' | 'warning' | 'info';
  message?: string;
  source?: string;
};

export type DeferredDiagnosticsResult =
  | { status: 'pending' }
  | { status: 'completed'; diagnostics: DeferredDiagnostic[] }
  | { status: 'failed'; error: string };

export async function getDeferredDiagnostics(id: string): Promise<DeferredDiagnosticsResult> {
  return apiCall<DeferredDiagnosticsResult>(
    `/api/providers/deferred-diagnostics/${encodeURIComponent(id)}`
  );
}

export type FileBackupRestoreResult = {
  id: string;
  originalPath: string;
  path: string;
  restored: true;
};

export async function restoreFileBackup(id: string): Promise<FileBackupRestoreResult> {
  return apiCall<FileBackupRestoreResult>(
    `/api/providers/file-history/backups/${encodeURIComponent(id)}/restore`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
}
