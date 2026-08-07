import type { InputHTMLAttributes } from 'react';

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Required: a checkbox with no adjacent text is unlabelled without it. */
  'aria-label': string;
}

/**
 * Standalone checkbox with a touch-sized hit area on phones.
 *
 * Use this only where the checkbox has no adjacent text — when it sits inside a
 * `<label>` alongside its caption, that label is already the tap target and
 * nesting another one would be invalid markup.
 *
 * The hit area comes from a padded wrapper label whose padding is cancelled by
 * an equal negative margin, so the control keeps its 16px layout footprint while
 * accepting taps across 40px. (A `::before` overlay on the input itself would
 * not render — form controls are replaced elements.)
 */
export function Checkbox({ className = '', ...rest }: CheckboxProps) {
  return (
    <label className="-m-3 flex shrink-0 cursor-pointer items-center p-3 md:m-0 md:p-0">
      <input
        type="checkbox"
        className={`h-4 w-4 rounded-md border-border md:h-3.5 md:w-3.5 ${className}`.trim()}
        {...rest}
      />
    </label>
  );
}
