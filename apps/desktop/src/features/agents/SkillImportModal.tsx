import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, CircleX, Minus, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { useIsMobile } from '../../hooks/useMediaQuery';
import {
  importExternalSkillsForBackend,
  scanExternalSkillsForBackend,
  type ExternalSkillImportOutcome,
  type ExternalSkillImportResult,
  type ExternalSkillScan,
} from '../../services/api';

export interface SkillImportModalProps {
  open: boolean;
  /** Backend whose server performs the scan/import (targets its global dir). */
  backendId: string | null;
  onClose: () => void;
  /** Called after an import that imported at least one skill. */
  onImported: () => void;
}

type ImportMode = 'symlink' | 'copy';

const MODE_OPTIONS: Array<{ value: ImportMode; label: string }> = [
  { value: 'symlink', label: 'Symlink (tracks source changes)' },
  { value: 'copy', label: 'Copy (standalone duplicate)' },
];

const SKIP_REASON_TEXT: Record<string, string> = {
  target_exists: 'already imported',
  name_exists: 'same skill name exists',
  unreadable: 'unreadable SKILL.md',
};

function OutcomeRow({ outcome }: { outcome: ExternalSkillImportOutcome }) {
  const icon =
    outcome.status === 'imported' ? (
      <Check className="h-3.5 w-3.5 text-success" strokeWidth={1.75} />
    ) : outcome.status === 'skipped' ? (
      <Minus className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
    ) : (
      <CircleX className="h-3.5 w-3.5 text-destructive" strokeWidth={1.75} />
    );
  const detail =
    outcome.status === 'imported'
      ? undefined
      : (SKIP_REASON_TEXT[outcome.reason ?? ''] ?? outcome.reason);
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-sm">
      {icon}
      <span className="truncate">{outcome.name}</span>
      <span className="truncate text-[11px] text-muted-foreground/60">{outcome.agentLabel}</span>
      {detail && <span className="ml-auto text-[11px] text-muted-foreground">{detail}</span>}
    </div>
  );
}

/**
 * One-click import of skills from external agent CLIs (Claude Code / Codex /
 * Cursor). Scans the backend's well-known external skill directories, lets the
 * user pick skills, and imports them via symlink (default) or copy; results
 * are summarized per source. Import writes into the server's global skills
 * directory and records the origin in its skills-lock.
 */
export function SkillImportModal({ open, backendId, onClose, onImported }: SkillImportModalProps) {
  const [scan, setScan] = useState<ExternalSkillScan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<ImportMode>('symlink');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ExternalSkillImportResult | null>(null);
  const isMobile = useIsMobile();

  const loadScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setSelected(new Set());
    try {
      setScan(await scanExternalSkillsForBackend(backendId));
    } catch (err) {
      setScan(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [backendId]);

  useEffect(() => {
    if (open) void loadScan();
  }, [open, loadScan]);

  // Only importable candidates participate; collisions are filtered server-side.
  const importable = useMemo(
    () => (scan?.sources ?? []).flatMap(source => source.skills.filter(skill => skill.importable)),
    [scan]
  );

  const allSelected = importable.length > 0 && selected.size === importable.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleSkill = (key: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(importable.map(s => `${s.agent}:${s.name}`)));
  };

  const handleImport = async () => {
    if (importing || selected.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      const selections = importable
        .filter(skill => selected.has(`${skill.agent}:${skill.name}`))
        .map(skill => ({ agent: skill.agent, name: skill.name }));
      const importResult = await importExternalSkillsForBackend(backendId, selections, mode);
      setResult(importResult);
      if (importResult.outcomes.some(o => o.status === 'imported')) onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const importedCount = result?.outcomes.filter(o => o.status === 'imported').length ?? 0;

  const footer = result ? (
    <div className="flex justify-end gap-2">
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    </div>
  ) : (
    <div className="flex items-center justify-between gap-2">
      <Select
        value={mode}
        onChange={setMode}
        options={MODE_OPTIONS}
        size="md"
        ariaLabel="Import mode"
        disabled={importing}
      />
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => void handleImport()}
          disabled={importing || selected.size === 0}
        >
          {importing ? 'Importing…' : `Import${selected.size > 0 ? ` (${selected.size})` : ''}`}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Import skills from other agents"
      title={result ? 'Import complete' : 'Import skills from other agents'}
      footer={footer}
      size="md"
      bodyScrollable
      mobileFullscreen
      isMobile={isMobile}
    >
      <div className="flex flex-col gap-3 px-4 py-4">
        {error && (
          <div className="flex items-start gap-2 p-3 bg-destructive/10 rounded-lg text-sm">
            <CircleAlert
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
              strokeWidth={1.75}
            />
            <p className="text-destructive">{error}</p>
          </div>
        )}

        {result ? (
          <>
            <p className="text-sm text-muted-foreground">
              {importedCount === 1 ? '1 skill imported' : `${importedCount} skills imported`}
              {result.mode === 'symlink' ? ' via symlink' : ' via copy'} into the global skills
              directory.
            </p>
            <div className="flex flex-col">
              {result.outcomes.map(outcome => (
                <OutcomeRow key={`${outcome.agent}:${outcome.name}`} outcome={outcome} />
              ))}
            </div>
          </>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Scanning…</p>
        ) : importable.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-6 text-center">
            <p className="text-sm text-muted-foreground">No importable skills found</p>
            <p className="text-xs text-muted-foreground/60">
              Nothing detected from Claude Code, Codex CLI, or Cursor — or everything was already
              imported.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  aria-label="Select all skills"
                  checked={allSelected}
                  onChange={() => toggleAll()}
                />
                Select all{someSelected ? ' (partial)' : ''}
              </label>
              <button
                type="button"
                onClick={() => void loadScan()}
                disabled={loading || importing}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                aria-label="Rescan"
              >
                <RefreshCw className="h-3 w-3" strokeWidth={1.75} /> Rescan
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {(scan?.sources ?? []).map(source => {
                const importableSkills = source.skills.filter(s => s.importable);
                const skippedCount = source.skills.length - importableSkills.length;
                return (
                  <div key={source.agent} className="flex flex-col gap-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">{source.agentLabel}</span>
                      <span className="truncate font-mono text-[10px] text-muted-foreground/60">
                        {source.status === 'ok' ? source.path : 'not found'}
                      </span>
                      {skippedCount > 0 && (
                        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/60">
                          {skippedCount} skipped
                        </span>
                      )}
                    </div>
                    {importableSkills.length === 0 ? (
                      <p className="px-2 text-xs text-muted-foreground/60">Nothing to import</p>
                    ) : (
                      <div className="flex flex-col">
                        {importableSkills.map(skill => {
                          const key = `${skill.agent}:${skill.name}`;
                          return (
                            <label
                              key={key}
                              className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-secondary"
                            >
                              <Checkbox
                                aria-label={`Import ${skill.name}`}
                                checked={selected.has(key)}
                                onChange={e => toggleSkill(key, e.target.checked)}
                              />
                              <span className="truncate">{skill.skillName ?? skill.name}</span>
                              {skill.version && (
                                <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                                  v{skill.version}
                                </span>
                              )}
                              {skill.description && (
                                <span className="ml-auto hidden truncate text-[11px] text-muted-foreground sm:block">
                                  {skill.description}
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
