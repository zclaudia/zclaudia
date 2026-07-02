import { symbolMarkupForFile } from './mapping';

/**
 * Symbols-style file-type glyph. Colors come exclusively from the
 * --glyph-* theme tokens baked into the generated markup — the sanctioned
 * colored-icon exception in docs/ui-conventions.md §3. The markup is
 * build-time-generated trusted content (gen:symbols), never user input,
 * so dangerouslySetInnerHTML is safe here.
 */
export function FileSymbol({
  name,
  className,
  size,
}: {
  name: string;
  className?: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full ${className ?? ''}`}
      style={size !== undefined ? { width: size, height: size } : undefined}
      dangerouslySetInnerHTML={{ __html: symbolMarkupForFile(name) }}
    />
  );
}
