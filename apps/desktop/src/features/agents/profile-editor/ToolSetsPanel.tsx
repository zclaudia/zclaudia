import { ChevronRight } from 'lucide-react';
import type { ProfileConfigDescriptor } from '@zclaudia/shared/core/profile-config-descriptor';
import type { ToolName, ToolSelection } from '@zclaudia/shared/core/tools';
import {
  BUILTIN_TOOL_METADATA,
  BUILTIN_TOOL_SETS,
  resolveToolSelection,
} from '@zclaudia/shared/core/tools';
import { Checkbox } from '../../../components/ui/Checkbox';
import { CapabilityNote } from './CapabilityNote';
import type { BuiltinToolSetId } from './derive';
import { toolSetPreview } from './derive';

/** One entry of the built-in tool-set catalog shown in the Tools sub-panel. */
export type BuiltinToolSetEntry = Omit<(typeof BUILTIN_TOOL_SETS)[BuiltinToolSetId], 'id'> & {
  id: BuiltinToolSetId;
};

/**
 * "Tools" sub-panel of the profile editor's Capabilities tab: the built-in
 * tool-set checkboxes with per-set customization, or a read-only note when the
 * runtime does not allow per-profile tool configuration.
 *
 * Purely presentational — the selection state lives in the parent's
 * `useToolSetSelection` hook and every mutation flows back through the toggle
 * callbacks.
 */
export function ToolSetsPanel({
  descriptor,
  entries,
  formToolSelection,
  customizedToolSetIds,
  expandedToolSetIds,
  toggleToolSet,
  toggleToolSetExpanded,
  toggleToolSetCustomize,
  toggleCustomTool,
}: {
  descriptor: ProfileConfigDescriptor;
  entries: BuiltinToolSetEntry[];
  formToolSelection: ToolSelection;
  customizedToolSetIds: BuiltinToolSetId[];
  expandedToolSetIds: BuiltinToolSetId[];
  toggleToolSet: (setId: BuiltinToolSetId) => void;
  toggleToolSetExpanded: (setId: BuiltinToolSetId) => void;
  toggleToolSetCustomize: (setId: BuiltinToolSetId) => void;
  toggleCustomTool: (setId: BuiltinToolSetId, tool: ToolName) => void;
}) {
  if (descriptor.capabilities.tools !== 'profile') {
    return (
      <CapabilityNote
        title="Claude provides its own tools"
        body="Built-in tool sets are not injected into the Claude runtime. Only plugin, skill, and interaction tools bridge through the claudia-plugins MCP server."
      />
    );
  }

  const resolvedBuiltinTools = resolveToolSelection(formToolSelection).builtinTools;

  return (
    <>
      <div className="space-y-2">
        {entries.map(set => {
          const checked = formToolSelection.sets.some(
            selected => selected.source === 'builtin' && selected.id === set.id
          );
          const customized = customizedToolSetIds.includes(set.id);
          const expanded = expandedToolSetIds.includes(set.id);
          return (
            <div
              key={set.id}
              className={`min-w-0 rounded-lg border p-3 text-sm transition-colors ${
                checked
                  ? 'bg-muted/60 border-primary/45 text-primary shadow-sm'
                  : customized
                    ? 'bg-secondary/80 border-primary/25 text-foreground'
                    : 'bg-secondary/60 border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Checkbox
                  checked={checked}
                  onChange={() => toggleToolSet(set.id)}
                  aria-label={`enable full tool set ${set.id}`}
                />
                <button
                  type="button"
                  onClick={() => toggleToolSetExpanded(set.id)}
                  aria-label={`expand tool set ${set.id}`}
                  aria-expanded={expanded}
                  className="min-w-0 flex-1 py-1 text-left"
                >
                  {/* The set name is what identifies the row, so it
                      keeps the first line to itself at phone width;
                      the tool preview drops below rather than
                      competing for the same shrinkable space. */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="min-w-0 flex-1 truncate font-medium">{set.label}</div>
                    <span className="hidden shrink-0 rounded-full bg-background/70 border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground md:inline-block">
                      {set.tools.length} tools
                    </span>
                    <span className="hidden min-w-0 flex-[2] truncate text-xs text-muted-foreground md:block">
                      {toolSetPreview(set.tools)}
                    </span>
                    <ChevronRight
                      size={14}
                      strokeWidth={2}
                      aria-hidden="true"
                      className={`shrink-0 text-muted-foreground/70 transition-transform ${expanded ? 'rotate-90' : ''}`}
                    />
                  </div>
                  {/* The count rides the preview line on a phone so the
                      set name keeps the first line to itself. */}
                  <div className="mt-0.5 truncate text-xs text-muted-foreground md:hidden">
                    {set.tools.length} tools · {toolSetPreview(set.tools)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => toggleToolSetCustomize(set.id)}
                  aria-label={`customize tool set ${set.id}`}
                  className={`shrink-0 rounded-md border px-2 py-1 text-[11px] transition-colors max-md:py-2 ${
                    customized
                      ? 'border-primary/40 bg-muted/60 text-primary'
                      : 'border-border bg-background/70 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {customized ? 'Custom' : 'Customize'}
                </button>
              </div>
              {expanded && (
                <div className="mt-3 space-y-1 border-t border-border/70 pt-2">
                  {set.tools.map(tool => {
                    const selected = customized
                      ? formToolSelection.include.some(
                          ref => ref.source === 'builtin' && ref.name === tool
                        )
                      : checked;
                    const metadata = BUILTIN_TOOL_METADATA[tool];
                    return (
                      <label
                        key={tool}
                        className={`flex items-start gap-3 rounded-md bg-background/60 px-2 py-2 ${
                          customized ? 'cursor-pointer hover:bg-background/80' : ''
                        }`}
                      >
                        {customized ? (
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleCustomTool(set.id, tool)}
                            aria-label={`select tool ${tool}`}
                            className="mt-0.5 shrink-0"
                          />
                        ) : (
                          <span
                            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${selected ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-xs" title={tool}>
                            {tool}
                          </span>
                          <span
                            className="mt-0.5 block truncate text-[11px] text-muted-foreground"
                            title={metadata.description || metadata.label}
                          >
                            {metadata.description || metadata.label}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Resolved built-in tools: {resolvedBuiltinTools.join(', ') || 'none'}
      </p>
    </>
  );
}
