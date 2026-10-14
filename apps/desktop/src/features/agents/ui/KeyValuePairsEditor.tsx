import { FIELD_CLASS } from '../../../components/ui/Input';

/** One editable `key`/`value` string pair. */
export interface KeyValuePair {
  key: string;
  value: string;
}

/**
 * Add/edit/remove editor for a list of string key/value pairs. The MCP server
 * editor renders one instance per transport for env vars (stdio) and HTTP
 * headers (remote) — the two blocks were previously near-verbatim duplicates.
 *
 * Purely presentational: the parent owns the pair state and funnels every
 * change through `onChange`; blurs flush the pending autosave via `onFlush`.
 */
export function KeyValuePairsEditor({
  label,
  pairs,
  onChange,
  keyPlaceholder,
  removeLabel,
  onFlush,
}: {
  label: string;
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  keyPlaceholder: string;
  /** Accessible label of the per-row remove button. */
  removeLabel: string;
  onFlush: () => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <button
          type="button"
          onClick={() => onChange([...pairs, { key: '', value: '' }])}
          className="-m-1.5 p-1.5 text-xs text-primary transition-colors hover:text-primary/80 md:m-0 md:p-0"
        >
          + Add
        </button>
      </div>
      {pairs.map((pair, i) => (
        <div key={i} className="mb-1 flex gap-2">
          <input
            type="text"
            value={pair.key}
            onChange={e => {
              const updated = [...pairs];
              updated[i] = { ...pair, key: e.target.value };
              onChange(updated);
            }}
            onBlur={onFlush}
            placeholder={keyPlaceholder}
            className={`${FIELD_CLASS} flex-1 font-mono text-xs`}
          />
          <input
            type="text"
            value={pair.value}
            onChange={e => {
              const updated = [...pairs];
              updated[i] = { ...pair, value: e.target.value };
              onChange(updated);
            }}
            onBlur={onFlush}
            placeholder="value"
            className={`${FIELD_CLASS} flex-1 font-mono text-xs`}
          />
          <button
            type="button"
            onClick={() => onChange(pairs.filter((_, j) => j !== i))}
            className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive max-md:p-2"
            aria-label={removeLabel}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
  );
}
