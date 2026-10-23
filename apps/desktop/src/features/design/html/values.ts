const SAFE_COLOR_NAMES = new Set([
  'transparent',
  'currentcolor',
  'black',
  'white',
  'red',
  'green',
  'blue',
  'yellow',
  'orange',
  'purple',
  'pink',
  'gray',
  'grey',
  'silver',
  'navy',
  'teal',
  'maroon',
  'olive',
  'lime',
  'aqua',
  'fuchsia',
  'rebeccapurple',
]);

/** Whitelist a user-provided color value. Returns the trimmed value, or null when unsafe. */
export function safeColor(value: string): string | null {
  const color = value.trim();
  if (!color || color.length > 80 || /[;{}<>\\]|url\s*\(|var\s*\(|expression/i.test(color))
    return null;
  if (
    /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color) ||
    SAFE_COLOR_NAMES.has(color.toLowerCase())
  )
    return color;
  if (/^(?:rgb|rgba|hsl|hsla)\([\d.%\s,+/-]+\)$/i.test(color)) return color;
  return null;
}

/** Escape a value for insertion as element text: & < > become entities. */
export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape a value for insertion inside a double-quoted attribute: & and " become entities. */
export function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
