import { useId, type ReactNode } from 'react';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

export function FormField({
  label,
  error,
  required,
  description,
  children,
}: {
  label: ReactNode;
  error?: string | null;
  required?: boolean;
  description?: ReactNode;
  children: (fieldProps: FieldControlProps) => ReactNode;
}) {
  const baseId = useId();
  const errorId = `${baseId}-error`;
  const descId = `${baseId}-desc`;
  const describedBy =
    [description ? descId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  const fieldProps: FieldControlProps = {
    id: baseId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    'aria-required': required ? true : undefined,
  };

  return (
    <div>
      <label htmlFor={baseId} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {required && (
          <span aria-hidden="true" className="text-destructive">
            {' '}
            *
          </span>
        )}
      </label>
      {description && (
        <p id={descId} className="mb-1 text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {children(fieldProps)}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
