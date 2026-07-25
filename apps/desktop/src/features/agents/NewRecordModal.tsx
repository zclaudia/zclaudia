import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

export interface NewRecordModalProps {
  open: boolean;
  title: string;
  label: string;
  placeholder: string;
  /** Render the input in a monospace font (e.g. for a skill id). */
  mono?: boolean;
  /** Create the draft from the trimmed value; throws on failure. On success
   *  the parent is expected to close the modal (state change). */
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}

export function NewRecordModal({
  open,
  title,
  label,
  placeholder,
  mono,
  onSubmit,
  onClose,
}: NewRecordModalProps) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue('');
      setError(null);
      setSubmitting(false);
      inputRef.current?.focus();
    }
  }, [open]);

  const canCreate = Boolean(value.trim()) && !submitting;

  const handleCreate = async () => {
    if (!canCreate) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(value.trim());
      // Success: the parent closes the modal by changing state; nothing to do.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={() => void handleCreate()} disabled={!canCreate}>
        {submitting ? 'Creating…' : 'Create'}
      </Button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel={title}
      title={title}
      footer={footer}
      size="md"
      bodyScrollable={false}
    >
      <div className="flex flex-col gap-4 px-4 py-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
          <input
            ref={inputRef}
            type="text"
            aria-label={label}
            value={value}
            onChange={e => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && canCreate) void handleCreate();
            }}
            placeholder={placeholder}
            className={`h-9 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50 ${mono ? 'font-mono' : ''}`.trim()}
          />
        </label>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
    </Modal>
  );
}
