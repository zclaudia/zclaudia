export type TextBlock = { type: 'text'; text: string };
export type ImageBlock = { type: 'image'; data: string; mimeType: string };
export type ToolContent = Array<TextBlock | ImageBlock>;

export function textResult<TDetails extends Record<string, unknown> = Record<string, never>>(
  text: string,
  details?: TDetails
): { content: ToolContent; details: TDetails | Record<string, never> } {
  return { content: [{ type: 'text', text }], details: details ?? {} };
}

export function jsonResult(value: unknown): {
  content: ToolContent;
  details: Record<string, never>;
} {
  return textResult(JSON.stringify(value, null, 2));
}

export function errorResult(
  code: string,
  message: string,
  details: Record<string, unknown> = {}
): { content: ToolContent; details: Record<string, unknown> } {
  return textResult(message, { ok: false, error: code, message, ...details });
}

export function toolParams(first: unknown, second: unknown): Record<string, unknown> {
  const candidate = second ?? first;
  return candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>) : {};
}

export function truncateText(value: string, limit = 80_000): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n... [truncated ${value.length - limit} chars]`;
}
