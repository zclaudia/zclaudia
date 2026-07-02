import { closeSync, openSync, readSync, statSync } from 'fs';

export type TaskOutputWindowParams =
  | { ok: true; outputOffset: number; tailLines?: number }
  | {
      ok: false;
      code: 'invalid_output_offset' | 'invalid_tail_lines';
      message: string;
      details: Record<string, unknown>;
    };

function parseIntegerParam(
  value: unknown,
  name: string,
  options: { min: number; max?: number }
): { ok: true; value: number } | { ok: false; message: string } {
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value)) {
    return { ok: false, message: `${name} must be an integer` };
  }
  if (value < options.min) {
    return { ok: false, message: `${name} must be >= ${options.min}` };
  }
  if (options.max !== undefined && value > options.max) {
    return { ok: false, message: `${name} must be <= ${options.max}` };
  }
  return { ok: true, value };
}

export function parseTaskOutputWindowParams(args: Record<string, unknown>): TaskOutputWindowParams {
  const offsetValue = args.output_offset;
  const tailValue = args.tail_lines;
  const outputOffset =
    offsetValue === undefined ? 0 : parseIntegerParam(offsetValue, 'output_offset', { min: 0 });
  if (typeof outputOffset !== 'number' && !outputOffset.ok) {
    return {
      ok: false,
      code: 'invalid_output_offset',
      message: outputOffset.message,
      details: { value: offsetValue },
    };
  }
  if (tailValue === undefined) {
    return {
      ok: true,
      outputOffset: typeof outputOffset === 'number' ? outputOffset : outputOffset.value,
    };
  }
  const tailLines = parseIntegerParam(tailValue, 'tail_lines', { min: 1, max: 2_000 });
  if (!tailLines.ok) {
    return {
      ok: false,
      code: 'invalid_tail_lines',
      message: tailLines.message,
      details: { value: tailValue, max: 2_000 },
    };
  }
  return {
    ok: true,
    outputOffset: typeof outputOffset === 'number' ? outputOffset : outputOffset.value,
    tailLines: tailLines.value,
  };
}

export function readLogWindow(filePath: string, offset: number, length: number): string {
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const bytes = readSync(fd, buf, 0, length, offset);
    return buf.subarray(0, bytes).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

export function readTaskLogWindow(
  logPath: string,
  args: Record<string, unknown>,
  capBytes = 50 * 1024
):
  | { ok: true; output: string; size: number; nextOffset: number; eof: boolean; truncated: boolean }
  | {
      ok: false;
      code: 'invalid_output_offset' | 'invalid_tail_lines';
      message: string;
      details: Record<string, unknown>;
    } {
  const windowParams = parseTaskOutputWindowParams(args);
  if (!windowParams.ok) return windowParams;
  const requestedOffset = windowParams.outputOffset;
  let output = '';
  let size = 0;
  try {
    size = statSync(logPath).size;
    if (windowParams.tailLines !== undefined) {
      const start = Math.max(0, size - capBytes);
      output = readLogWindow(logPath, start, size - start);
      const hadTrailingNewline = output.endsWith('\n');
      const lines = output.split('\n');
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      output = lines.slice(-windowParams.tailLines).join('\n') + (hadTrailingNewline ? '\n' : '');
    } else {
      const offset = Math.min(requestedOffset, size);
      const len = Math.min(size - offset, capBytes);
      output = len > 0 ? readLogWindow(logPath, offset, len) : '';
    }
  } catch {
    // no log yet - empty output
  }
  const eof =
    windowParams.tailLines !== undefined ||
    size <= requestedOffset + Buffer.byteLength(output, 'utf8');
  const truncated =
    windowParams.tailLines !== undefined
      ? size > Buffer.byteLength(output, 'utf8')
      : size - requestedOffset > Buffer.byteLength(output, 'utf8');
  return { ok: true, output, size, nextOffset: size, eof, truncated };
}
