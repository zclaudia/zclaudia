import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentProfileConfig, LlmProfileConfig } from '@zclaudia/shared';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { useRuntimeDescriptorStore } from '../../stores/runtimeDescriptorStore';
import * as api from '../../services/api';
import { buildDefaultProfilePayload } from './buildDefaultProfilePayload';

interface NewAgentProfileModalProps {
  open: boolean;
  backendId: string;
  onClose: () => void;
  onCreated: (saved: AgentProfileConfig) => void;
}

export function NewAgentProfileModal({
  open,
  backendId,
  onClose,
  onCreated,
}: NewAgentProfileModalProps) {
  const descriptors = useRuntimeDescriptorStore(s => s.getDescriptors(backendId));
  const enabled = useMemo(() => descriptors.filter(d => d.enabled), [descriptors]);

  const [name, setName] = useState('');
  const [runtimeType, setRuntimeType] = useState('');
  const [llmProfiles, setLlmProfiles] = useState<LlmProfileConfig[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const selectedRuntime = runtimeType || enabled[0]?.runtime || 'zclaudia';
  const descriptor = enabled.find(d => d.runtime === selectedRuntime);

  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    void api
      .listLlmProfilesForBackend(backendId)
      .then(list => {
        if (!cancelled) setLlmProfiles(list);
      })
      .catch(() => {
        if (!cancelled) setLlmProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [backendId]);

  // Resolve the default payload up front so we can gate Create and surface the
  // no-model edge case before any request goes out.
  const build = descriptor
    ? buildDefaultProfilePayload({ name, runtimeType: selectedRuntime, descriptor, llmProfiles })
    : null;
  const noRuntimeHint =
    enabled.length === 0 || !descriptor
      ? 'Agent runtimes are still loading — try again in a moment.'
      : null;
  const buildError =
    build && !build.ok
      ? build.reason === 'no-model'
        ? 'The selected LLM profile has no available models — declare a model on the LLM profile first.'
        : 'No LLM profile is available — create one first.'
      : null;
  const canCreate = Boolean(name.trim()) && !submitting && build !== null && build.ok;

  const handleCreate = async () => {
    if (!descriptor || !build || !build.ok) return;
    setSubmitting(true);
    setError(null);
    try {
      const saved = await api.createAgentProfileForBackend(backendId, build.payload);
      onCreated(saved);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to create agent: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <button
        onClick={onClose}
        className="h-7 rounded-xl px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        Cancel
      </button>
      <button
        onClick={handleCreate}
        disabled={!canCreate}
        className="h-7 rounded-xl bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-apple-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? 'Creating…' : 'Create'}
      </button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="New agent profile"
      title="New agent profile"
      footer={footer}
      size="md"
    >
      <div className="flex flex-col gap-4 px-4 py-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Name</span>
          <input
            ref={nameRef}
            type="text"
            aria-label="Name"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && canCreate) void handleCreate();
            }}
            placeholder="e.g., Default Coding Agent"
            className="h-9 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Agent Type</span>
          <Select
            value={selectedRuntime}
            onChange={setRuntimeType}
            block
            size="md"
            triggerClassName="!h-9 !rounded-xl !text-[13px]"
            options={enabled.map(d => ({ value: d.runtime, label: d.label }))}
          />
        </div>

        {(error ?? buildError ?? noRuntimeHint) && (
          <p className="text-[11px] text-destructive">{error ?? buildError ?? noRuntimeHint}</p>
        )}
      </div>
    </Modal>
  );
}
