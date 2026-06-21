import { getIcon } from 'material-file-icons';

/**
 * Renders a Material Icon Theme file-type icon (the same set Cursor/VS Code use).
 * The SVGs are self-colored, so we render them raw and let their own fills show
 * through in both light and dark mode — no text-color class needed.
 */
export function FileTypeIcon({ name, className }: { name: string; className?: string }) {
  const { svg } = getIcon(name);
  return (
    <span
      aria-hidden="true"
      className={className}
      // Icons are static, bundled SVG strings from material-file-icons — safe to inline.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
