import type { AgentTool } from '@earendil-works/pi-agent-core';
import { readFile, stat } from 'fs/promises';
import * as path from 'path';

import type { ReadFileStateStore } from './read-file-state.js';
import { decodeTextBuffer } from './text-io.js';
import { buildHashlineEntries, formatHashlineOutput, hashlineSnapshotId, hashlineTag } from './hashline.js';
import { compressImageToLimit, extractPdfText, renderNotebook } from './rich-read.js';
import { errorResult, textResult, toolParams } from './tool-common.js';
import { resolveInsideWorkspace, toWorkspaceRelative } from './workspace-paths.js';

export interface ReadToolOptions {
  supportsVision?: boolean;
  readFileState?: ReadFileStateStore;
}

const DEFAULT_READ_MAX_BYTES = 512 * 1024;
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_NOTEBOOK_BYTES = 20 * 1024 * 1024;

function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

function formatNumberedLines(lines: string[], startLine: number): string {
  return lines.map((line, index) => `${startLine + index}|${line}`).join('\n');
}

export function createReadBridgeTool(cwd: string, options?: ReadToolOptions): AgentTool<any> {
  return {
    name: 'Read',
    label: 'Read',
    description: 'Read a file. Text files use line pagination; images return vision blocks (oversized ones are downscaled automatically); .ipynb notebooks render as cells with outputs; PDFs extract text per page (use pages, e.g. "1-5", max 20 pages per call).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        file_path: { type: 'string' },
        offset: { type: 'number', default: 1 },
        limit: { type: 'number', default: 200 },
        pages: { type: 'string', description: 'For PDFs: page range like "1-5" or "2,7" (max 20 pages per call)' },
      },
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const requestedPath = args.path ?? args.file_path;
      if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
        return errorResult('missing_path', 'read requires a path');
      }
      let filePath: string;
      try {
        filePath = resolveInsideWorkspace(cwd, requestedPath);
      } catch (err) {
        return errorResult('path_outside_workspace', err instanceof Error ? err.message : String(err));
      }

      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) {
          return errorResult('not_a_file', `Path is not a file: ${requestedPath}`, { path: String(requestedPath) });
        }
        const fileExt = path.extname(filePath).toLowerCase();
        const imageMime = IMAGE_MIME_BY_EXT[fileExt];
        if (imageMime) {
          const relPath = toWorkspaceRelative(cwd, filePath);
          if (!options?.supportsVision) {
            return textResult(`Image file ${relPath} (${imageMime}, ${fileStat.size} bytes) - current model does not support vision.`, {
              ok: false, path: relPath, size: fileStat.size, mimeType: imageMime,
            });
          }
          const buffer = await readFile(filePath);
          if (fileStat.size > MAX_IMAGE_BYTES) {
            const compressed = await compressImageToLimit(buffer, MAX_IMAGE_BYTES);
            if (!compressed) {
              return textResult(`Image file ${relPath} (${imageMime}, ${fileStat.size} bytes) exceeds the 5MB vision limit and could not be downscaled.`, {
                ok: false, path: relPath, size: fileStat.size, mimeType: imageMime,
              });
            }
            return {
              content: [{ type: 'image' as const, data: compressed.data.toString('base64'), mimeType: compressed.mimeType }],
              details: {
                ok: true, path: relPath, size: compressed.data.length, mimeType: compressed.mimeType,
                resized: true, originalSize: fileStat.size,
              },
            };
          }
          return {
            content: [{ type: 'image' as const, data: buffer.toString('base64'), mimeType: imageMime }],
            details: { ok: true, path: relPath, size: fileStat.size, mimeType: imageMime },
          };
        }

        if (fileExt === '.pdf') {
          const relPath = toWorkspaceRelative(cwd, filePath);
          if (fileStat.size > MAX_PDF_BYTES) {
            return errorResult('file_too_large', `PDF is too large to read: ${requestedPath}`, {
              path: relPath, size: fileStat.size, maxBytes: MAX_PDF_BYTES,
            });
          }
          const buffer = await readFile(filePath);
          const pdf = await extractPdfText(buffer, typeof args.pages === 'string' ? args.pages : undefined);
          return textResult(pdf.text || '(no extractable text)', {
            ok: true, path: relPath, format: 'pdf', totalPages: pdf.totalPages, pages: pdf.pages, size: fileStat.size,
          });
        }

        if (fileExt === '.ipynb') {
          if (fileStat.size > MAX_NOTEBOOK_BYTES) {
            return errorResult('file_too_large', `Notebook is too large to read: ${requestedPath}`, {
              path: toWorkspaceRelative(cwd, filePath), size: fileStat.size, maxBytes: MAX_NOTEBOOK_BYTES,
            });
          }
          const buffer = await readFile(filePath);
          const rendered = renderNotebook(decodeTextBuffer(buffer).content);
          const relPath = toWorkspaceRelative(cwd, filePath);
          const lines = rendered.split('\n');
          const totalLines = lines.length;
          const offset = Math.max(1, Number(args.offset ?? 1) || 1);
          const limit = Math.max(1, Math.min(Number(args.limit ?? 200) || 200, 2000));
          const selected = lines.slice(offset - 1, offset - 1 + limit);
          return textResult(formatNumberedLines(selected, offset), {
            ok: true, path: relPath, format: 'notebook', offset, limit, totalLines,
            returnedLines: selected.length, size: fileStat.size,
          });
        }

        if (fileStat.size > DEFAULT_READ_MAX_BYTES) {
          return errorResult('file_too_large', `File is too large to read in one call: ${requestedPath}`, {
            path: toWorkspaceRelative(cwd, filePath),
            size: fileStat.size,
            maxBytes: DEFAULT_READ_MAX_BYTES,
          });
        }
        const buffer = await readFile(filePath);
        const decoded = decodeTextBuffer(buffer);
        if (decoded.encoding === 'utf8' && !decoded.hasBom && isBinaryBuffer(buffer)) {
          return errorResult('binary_file', `Refusing to read binary file: ${requestedPath}`, {
            path: toWorkspaceRelative(cwd, filePath),
            size: fileStat.size,
          });
        }
        const text = decoded.content;
        const lines = text.split(/\r?\n/);
        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
        const totalLines = lines.length;
        const offset = Math.max(1, Number(args.offset ?? 1) || 1);
        const limit = Math.max(1, Math.min(Number(args.limit ?? 200) || 200, 2000));
        const selected = lines.slice(offset - 1, offset - 1 + limit);
        const relPath = toWorkspaceRelative(cwd, filePath);
        const hashlineEntries = args.hashline === true ? buildHashlineEntries(selected) : undefined;
        await options?.readFileState?.recordRead(filePath, {
          content: text,
          offset,
          limit,
          totalLines,
          returnedLines: selected.length,
          timestamp: fileStat.mtimeMs,
        });
        return textResult(
          args.hashline === true
            ? formatHashlineOutput(relPath, text, hashlineEntries ?? [])
            : formatNumberedLines(selected, offset),
          {
            ok: true,
            path: relPath,
            offset,
            limit,
            totalLines,
            returnedLines: selected.length,
            size: fileStat.size,
            ...(args.hashline === true ? {
              hashline: {
                path: relPath,
                tag: hashlineTag(text),
                snapshotId: hashlineSnapshotId(relPath, text),
                lines: hashlineEntries,
              },
            } : {}),
          });
      } catch (err) {
        return errorResult('read_failed', err instanceof Error ? err.message : String(err), {
          path: String(requestedPath),
        });
      }
    },
  } as unknown as AgentTool<any>;
}
