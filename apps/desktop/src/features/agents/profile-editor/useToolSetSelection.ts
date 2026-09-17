import { useState } from 'react';
import type { ToolName, ToolSelection } from '@zclaudia/shared';
import {
  BUILTIN_TOOL_SETS,
  builtinToolRef,
  defaultToolSelection,
  resolveToolSelection,
} from '@zclaudia/shared';
import {
  deriveCustomizedToolSetIds,
  removeBuiltinRefsForTools,
  type BuiltinToolSetId,
} from './derive';

/**
 * Tool-set tree + MCP provider selection state for the profile editor's
 * Capabilities tab. Owns the `toolSelection` form state together with the
 * per-set customization/expansion UI state derived alongside it.
 */
export function useToolSetSelection() {
  const [formToolSelection, setFormToolSelection] = useState<ToolSelection>(defaultToolSelection);
  const [customizedToolSetIds, setCustomizedToolSetIds] = useState<BuiltinToolSetId[]>([]);
  const [expandedToolSetIds, setExpandedToolSetIds] = useState<BuiltinToolSetId[]>([]);

  /** Replaces the selection wholesale (form populate) and resets the per-set UI state. */
  const applySelection = (next: ToolSelection) => {
    setFormToolSelection(next);
    setCustomizedToolSetIds(deriveCustomizedToolSetIds(next));
    setExpandedToolSetIds([]);
  };

  const toggleToolSetExpanded = (setId: BuiltinToolSetId) => {
    setExpandedToolSetIds(current =>
      current.includes(setId) ? current.filter(id => id !== setId) : [...current, setId]
    );
  };

  const toggleToolSet = (setId: keyof typeof BUILTIN_TOOL_SETS) => {
    setFormToolSelection(current => {
      const set = BUILTIN_TOOL_SETS[setId];
      const exists = current.sets.some(set => set.source === 'builtin' && set.id === setId);
      return {
        ...current,
        sets: exists
          ? current.sets.filter(set => !(set.source === 'builtin' && set.id === setId))
          : [...current.sets, { source: 'builtin', id: setId }],
        include: removeBuiltinRefsForTools(current.include, set.tools),
        exclude: removeBuiltinRefsForTools(current.exclude, set.tools),
      };
    });
    setCustomizedToolSetIds(current => current.filter(id => id !== setId));
  };

  const toggleToolSetCustomize = (setId: BuiltinToolSetId) => {
    const set = BUILTIN_TOOL_SETS[setId];
    const customActive = customizedToolSetIds.includes(setId);
    if (customActive) {
      setCustomizedToolSetIds(current => current.filter(id => id !== setId));
      setFormToolSelection(current => ({
        ...current,
        include: removeBuiltinRefsForTools(current.include, set.tools),
        exclude: removeBuiltinRefsForTools(current.exclude, set.tools),
      }));
      return;
    }

    setCustomizedToolSetIds(current => [...current.filter(id => id !== setId), setId]);
    setExpandedToolSetIds(current => (current.includes(setId) ? current : [...current, setId]));
    setFormToolSelection(current => {
      const fullSetActive = current.sets.some(
        selected => selected.source === 'builtin' && selected.id === setId
      );
      const currentlyResolved = new Set(resolveToolSelection(current).builtinTools);
      const selectedTools = fullSetActive
        ? set.tools
        : set.tools.filter(tool => currentlyResolved.has(tool));
      return {
        ...current,
        sets: current.sets.filter(
          selected => !(selected.source === 'builtin' && selected.id === setId)
        ),
        include: [
          ...removeBuiltinRefsForTools(current.include, set.tools),
          ...selectedTools.map(builtinToolRef),
        ],
        exclude: removeBuiltinRefsForTools(current.exclude, set.tools),
      };
    });
  };

  const toggleCustomTool = (setId: BuiltinToolSetId, tool: ToolName) => {
    const set = BUILTIN_TOOL_SETS[setId];
    const ref = builtinToolRef(tool);
    setFormToolSelection(current => {
      const include = current.include.filter(
        item => !(item.source === 'builtin' && item.name === tool)
      );
      const selected = current.include.some(
        item => item.source === 'builtin' && item.name === tool
      );
      return {
        ...current,
        sets: current.sets.filter(
          selectedSet => !(selectedSet.source === 'builtin' && selectedSet.id === setId)
        ),
        include: selected ? include : [...include, ref],
        exclude: removeBuiltinRefsForTools(current.exclude, set.tools),
      };
    });
    setCustomizedToolSetIds(current => (current.includes(setId) ? current : [...current, setId]));
  };

  const mcpProviderSelected = (serverName: string) =>
    (formToolSelection.providers ?? []).some(
      provider => provider.source === 'mcp' && provider.serverId === serverName
    );

  const toggleMcpProvider = (serverName: string) => {
    setFormToolSelection(current => {
      const providers = current.providers ?? [];
      const selected = providers.some(
        provider => provider.source === 'mcp' && provider.serverId === serverName
      );
      return {
        ...current,
        providers: selected
          ? providers.filter(
              provider => !(provider.source === 'mcp' && provider.serverId === serverName)
            )
          : [...providers, { source: 'mcp', serverId: serverName }],
      };
    });
  };

  return {
    formToolSelection,
    customizedToolSetIds,
    expandedToolSetIds,
    applySelection,
    toggleToolSetExpanded,
    toggleToolSet,
    toggleToolSetCustomize,
    toggleCustomTool,
    mcpProviderSelected,
    toggleMcpProvider,
  };
}
