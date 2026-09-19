import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { probeLlmProfileModelPreviewForBackend } from '../../../services/api';
import type { LlmProfilePreviewInput } from '../../../services/api';
import type { ModelRowDraft } from '../llmProfileModelDraft';

/**
 * Per-row "Test model" async state machine for the Models tab. Drives the
 * probe lifecycle (running -> ok/fail) written into each draft row's
 * `testStatus`, plus the auto-clear timers that wipe the result a few seconds
 * later — including the unmount sweep so a removed row's timer can't fire
 * into the surviving rows.
 */
export function useModelTestState({
  backendId,
  formModels,
  setFormModels,
  buildPreviewInput,
}: {
  backendId: string;
  formModels: ModelRowDraft[];
  setFormModels: Dispatch<SetStateAction<ModelRowDraft[]>>;
  /** Snapshot of the *current* form draft for the F2 probe-preview endpoint. */
  buildPreviewInput: () => LlmProfilePreviewInput;
}) {
  const testStatusTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const timers = testStatusTimersRef.current;
    return () => {
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
    };
  }, []);

  const updateModelRowByUid = (rowUid: string, patch: Partial<ModelRowDraft>) => {
    setFormModels(rows => rows.map(r => (r.rowUid === rowUid ? { ...r, ...patch } : r)));
  };

  /** Cancel a row's pending auto-clear timer (called on row removal). */
  const clearTestStatusTimer = (rowUid: string) => {
    const t = testStatusTimersRef.current.get(rowUid);
    if (t != null) {
      window.clearTimeout(t);
      testStatusTimersRef.current.delete(rowUid);
    }
  };

  const scheduleClearTestStatus = (rowUid: string) => {
    const existing = testStatusTimersRef.current.get(rowUid);
    if (existing != null) window.clearTimeout(existing);
    const id = window.setTimeout(() => {
      testStatusTimersRef.current.delete(rowUid);
      setFormModels(rows =>
        rows.map(r => (r.rowUid === rowUid ? { ...r, testStatus: undefined } : r))
      );
    }, 6000);
    testStatusTimersRef.current.set(rowUid, id);
  };

  const probeModel = async (index: number) => {
    const row = formModels[index];
    const modelId = row?.modelId.trim();
    if (!row || !modelId) return;
    const rowUid = row.rowUid;
    // F2: probe-preview accepts the form draft so we can Test before saving.
    updateModelRowByUid(rowUid, { testStatus: { kind: 'running' } });
    try {
      const previewInput = buildPreviewInput();
      const result = await probeLlmProfileModelPreviewForBackend(backendId, previewInput, modelId);
      if (result.ok) {
        updateModelRowByUid(rowUid, { testStatus: { kind: 'ok', latencyMs: result.latencyMs } });
      } else {
        updateModelRowByUid(rowUid, { testStatus: { kind: 'fail', error: result.error } });
      }
    } catch (err) {
      updateModelRowByUid(rowUid, {
        testStatus: { kind: 'fail', error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      scheduleClearTestStatus(rowUid);
    }
  };

  return { probeModel, clearTestStatusTimer };
}
