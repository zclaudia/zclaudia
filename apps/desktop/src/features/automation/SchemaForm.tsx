interface FieldSchema {
  type?: string;
  enum?: string[];
  format?: string;
  description?: string;
}

interface ObjectSchema {
  properties?: Record<string, FieldSchema>;
  required?: string[];
}

function asObjectSchema(schema: Record<string, unknown> | undefined): ObjectSchema {
  if (!schema || typeof schema !== 'object') return {};
  const properties = (schema as ObjectSchema).properties;
  const required = (schema as ObjectSchema).required;
  return {
    properties: properties && typeof properties === 'object' ? properties : {},
    required: Array.isArray(required) ? required : [],
  };
}

/** Required keys whose value is missing or an empty string. */
export function missingRequiredKeys(
  schema: Record<string, unknown> | undefined,
  value: Record<string, unknown>
): string[] {
  const { required } = asObjectSchema(schema);
  return (required ?? []).filter(k => {
    const v = value[k];
    return v === undefined || v === null || v === '';
  });
}

export interface SchemaFormProps {
  schema?: Record<string, unknown>;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function SchemaForm({ schema, value, onChange }: SchemaFormProps) {
  const { properties } = asObjectSchema(schema);
  const entries = Object.entries(properties ?? {});
  if (entries.length === 0) return null;

  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  const inputClass =
    'w-full px-2 py-1 text-xs rounded-md border border-border bg-background text-foreground';

  return (
    <div className="flex flex-col gap-2">
      {entries.map(([key, field]) => {
        const current = value[key];
        const label = (
          <span className="text-[10px] text-muted-foreground">{field.description ?? key}</span>
        );

        if (field.type === 'boolean') {
          return (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={key}
                checked={current === true}
                onChange={e => set(key, e.target.checked)}
              />
              {label}
            </label>
          );
        }

        if (field.type === 'string' && Array.isArray(field.enum)) {
          return (
            <label key={key} className="flex flex-col gap-1">
              {label}
              <select
                aria-label={key}
                className={inputClass}
                value={typeof current === 'string' ? current : ''}
                onChange={e => set(key, e.target.value)}
              >
                <option value="" disabled>
                  Select…
                </option>
                {field.enum.map(opt => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          );
        }

        if (field.type === 'number' || field.type === 'integer') {
          return (
            <label key={key} className="flex flex-col gap-1">
              {label}
              <input
                type="number"
                aria-label={key}
                className={inputClass}
                value={typeof current === 'number' ? current : ''}
                onChange={e => set(key, e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </label>
          );
        }

        if (field.type === 'string' && field.format === 'multiline') {
          return (
            <label key={key} className="flex flex-col gap-1">
              {label}
              <textarea
                aria-label={key}
                rows={3}
                className={`${inputClass} resize-y`}
                value={typeof current === 'string' ? current : ''}
                onChange={e => set(key, e.target.value)}
              />
            </label>
          );
        }

        // Default: text input (covers 'string' and unknown types).
        return (
          <label key={key} className="flex flex-col gap-1">
            {label}
            <input
              type="text"
              aria-label={key}
              className={inputClass}
              value={typeof current === 'string' ? current : ''}
              onChange={e => set(key, e.target.value)}
            />
          </label>
        );
      })}
    </div>
  );
}
