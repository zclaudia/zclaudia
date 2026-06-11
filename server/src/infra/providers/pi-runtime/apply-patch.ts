export type ApplyPatchOperation =
  | { type: 'update'; path: string; oldText: string; newText: string }
  | { type: 'add'; path: string; content: string };

export function parseApplyPatch(input: string): ApplyPatchOperation[] {
  const lines = input.split(/\r?\n/);
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
      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        const patchLine = lines[index];
        if (patchLine.startsWith('-')) oldLines.push(patchLine.slice(1));
        else if (patchLine.startsWith('+')) newLines.push(patchLine.slice(1));
        else if (patchLine.startsWith(' ')) {
          oldLines.push(patchLine.slice(1));
          newLines.push(patchLine.slice(1));
        }
        index += 1;
      }
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
    throw new Error(`Unsupported patch operation: ${line}`);
  }
  return operations;
}
