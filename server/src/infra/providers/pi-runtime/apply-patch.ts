export type ApplyPatchOperation =
  | { type: 'update'; path: string; oldText: string; newText: string }
  | { type: 'add'; path: string; content: string }
  | { type: 'delete'; path: string }
  | { type: 'rename'; from: string; to: string };

export function parseApplyPatch(input: string): ApplyPatchOperation[] {
  const rawLines = input.split(/\r?\n/);
  // Models routinely paste the patch with a trailing newline (or a leading one)
  // — blank lines around the markers carry no meaning, so drop them before the
  // marker check instead of rejecting an otherwise well-formed patch.
  let start = 0;
  let end = rawLines.length;
  while (start < end && rawLines[start].trim() === '') start += 1;
  while (end > start && rawLines[end - 1].trim() === '') end -= 1;
  const lines = rawLines.slice(start, end);
  if (lines[0] !== '*** Begin Patch' || lines[lines.length - 1] !== '*** End Patch') {
    throw new Error('Patch must start with "*** Begin Patch" and end with "*** End Patch"');
  }

  const operations: ApplyPatchOperation[] = [];
  let index = 1;
  while (index < lines.length - 1) {
    const line = lines[index];
    if (line.startsWith('*** Update File: ')) {
      const filePath = line.slice('*** Update File: '.length).trim();
      index += 1;
      if (lines[index] === '@@') index += 1;
      const oldLines: string[] = [];
      const newLines: string[] = [];
      // Models often emit a bare empty line for a blank context line instead
      // of " ". Buffer blanks and only flush them as context when more hunk
      // lines follow — trailing blanks right before the next "***" marker are
      // separators between operations, not context.
      let pendingBlanks = 0;
      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        const patchLine = lines[index];
        if (patchLine === '') {
          pendingBlanks += 1;
          index += 1;
          continue;
        }
        const isRemoval = patchLine.startsWith('-');
        const isAddition = patchLine.startsWith('+');
        const isContext = patchLine.startsWith(' ');
        if (!isRemoval && !isAddition && !isContext) {
          // Unprefixed lines used to be silently dropped, which shortened
          // oldText/newText and surfaced later as a confusing not_found —
          // fail loudly at parse time instead.
          throw new Error(
            `Malformed update hunk for "${filePath}": line ${index + 1} must start with "-", "+", or a space`
          );
        }
        for (let blank = 0; blank < pendingBlanks; blank += 1) {
          oldLines.push('');
          newLines.push('');
        }
        pendingBlanks = 0;
        if (isRemoval) oldLines.push(patchLine.slice(1));
        if (isAddition) newLines.push(patchLine.slice(1));
        if (isContext) {
          oldLines.push(patchLine.slice(1));
          newLines.push(patchLine.slice(1));
        }
        index += 1;
      }
      // oldText/newText always end with '\n'. A hunk anchored at the end of a
      // file that has no trailing newline therefore cannot match as-is; the
      // caller (edit-write-tools) retries without the trailing newline when
      // the target file itself ends without one.
      operations.push({
        type: 'update',
        path: filePath,
        oldText: `${oldLines.join('\n')}\n`,
        newText: `${newLines.join('\n')}\n`,
      });
      continue;
    }
    if (line.startsWith('*** Add File: ')) {
      const filePath = line.slice('*** Add File: '.length).trim();
      index += 1;
      const contentLines: string[] = [];
      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        const patchLine = lines[index];
        if (!patchLine.startsWith('+')) throw new Error('Add File lines must start with "+"');
        contentLines.push(patchLine.slice(1));
        index += 1;
      }
      operations.push({ type: 'add', path: filePath, content: `${contentLines.join('\n')}\n` });
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      const filePath = line.slice('*** Delete File: '.length).trim();
      if (!filePath) throw new Error(`Missing delete path at line ${index + 1}`);
      operations.push({ type: 'delete', path: filePath });
      index += 1;
      continue;
    }
    if (line.startsWith('*** Rename File: ')) {
      const spec = line.slice('*** Rename File: '.length).trim();
      const match = /^(.*?)\s*->\s*(.*?)$/.exec(spec);
      if (!match?.[1] || !match[2])
        throw new Error(`Invalid rename operation at line ${index + 1}`);
      operations.push({ type: 'rename', from: match[1].trim(), to: match[2].trim() });
      index += 1;
      continue;
    }
    throw new Error(`Unsupported patch operation: ${line}`);
  }
  return operations;
}
