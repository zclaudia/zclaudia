import { DiffView } from '@zclaudia/agent-transcript-kit/react';

/**
 * Diff rendering now comes from the kit. These wrappers keep this app's two
 * call shapes — a pair of revisions, and a diff the agent already rendered —
 * mapping both onto the one shared component.
 */

export function DiffViewer({
  oldString,
  newString,
  filePath,
}: {
  oldString: string;
  newString: string;
  filePath?: string;
}) {
  return <DiffView oldText={oldString} newText={newString} filePath={filePath} />;
}

export function UnifiedDiffViewer({ diff, filePath }: { diff: string; filePath?: string }) {
  return <DiffView unified={diff} filePath={filePath} />;
}
