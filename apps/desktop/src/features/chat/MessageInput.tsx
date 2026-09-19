import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { KeyboardEvent, ClipboardEvent, ChangeEvent } from 'react';
import { ArrowUp, Paperclip, Square, Plus } from 'lucide-react';
import type { SlashCommand, FileEntry, SkillRef } from '@zclaudia/shared';
import { skillRefKey } from '@zclaudia/shared';
import * as api from '../../services/api';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useComposerStore } from '../../stores/composerStore';
import { useAgentProfileMetaStore } from '../../stores/agentProfileMetaStore';
import { useAgentForSession } from '../../hooks/useAgentForSession';
import type { InvocableDescriptor } from '@zclaudia/shared/providers';
import { RichTextarea, type RichTextareaHandle } from 'rich-textarea';
import { SlashMenu, type SlashSuggestion } from './SlashMenu';
import { PinnedSkillChips } from './PinnedSkillChips';
import { renderSkillTokens, deleteTokenAt, type TokenInteraction } from './SkillTokenRenderer';
import { MentionMenu } from './MentionMenu';
import { AttachmentPreviewList } from './AttachmentPreviewList';
import { useComposerDraft } from './hooks/useComposerDraft';
import { useMentionState, initialMentionState } from './hooks/useMentionState';
import { useAttachmentPicker } from './hooks/useAttachmentPicker';
import { useImeComposition } from './hooks/useImeComposition';
import { useViewportHeight } from './hooks/useViewportHeight';
import { useWorkspaceSkills } from './hooks/useWorkspaceSkills';
import { useSlashSuggestions } from './hooks/useSlashSuggestions';
import { useDuplicateSendGuard } from './hooks/useDuplicateSendGuard';
import type { Attachment } from './types';

// Canonical home of the composer's Attachment type; re-exported here for
// backwards compatibility with existing importers.
export type { Attachment } from './types';

interface MessageInputProps {
  sessionId: string; // Session ID for draft persistence
  onSend: (message: string, attachments?: Attachment[]) => void;
  onCancel?: () => void;
  onCommand?: (command: string, args: string) => void;
  /** URIP catalog matches for the text being typed (canonical invocables). */
  invocableSuggestions?: (typedText: string) => InvocableDescriptor[];
  /** Submit a canonical invocation for the selected catalog item. */
  onCanonicalInvocation?: (
    descriptor: InvocableDescriptor,
    args: string,
    attachments?: Attachment[]
  ) => Promise<boolean> | boolean;
  /** "Send literally" escape (§16.3): preserve reserved-namespace bytes. */
  onSendLiterally?: (text: string, attachments?: Attachment[]) => Promise<boolean> | boolean;
  /** Runtime namespace advertised by the session-scoped catalog. */
  reservedRuntimeType?: string;
  commands?: SlashCommand[]; // Commands from provider
  projectRoot?: string; // Project root for @ file mentions
  backendId?: string | null; // Backend ID for routing file listing API calls
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  initialValue?: string; // Initial value to set (e.g., for restoring after cancel)
  initialAttachments?: Attachment[]; // Initial attachments to restore
  mobileToolbarSlot?: React.ReactNode; // Extra buttons rendered in mobile action row
}

const COLLAPSED_CONTROL_SIZE_PX = 48;
const EXPANDED_INPUT_DEFAULT_HEIGHT_PX = 160;
const EXPANDED_INPUT_MIN_HEIGHT_PX = 120;

export function MessageInput({
  sessionId,
  onSend,
  onCancel,
  onCommand,
  invocableSuggestions,
  onCanonicalInvocation,
  onSendLiterally,
  reservedRuntimeType,
  commands = [],
  projectRoot,
  backendId,
  disabled = false,
  isLoading = false,
  placeholder = 'Type a message...',
  initialValue,
  initialAttachments,
  mobileToolbarSlot,
}: MessageInputProps) {
  const isMobile = useIsMobile();
  const clearDraft = useComposerStore(s => s.clearDraft);
  const { agent } = useAgentForSession(sessionId);
  const [value, setValue] = useState('');
  const [hoveredTokenStart, setHoveredTokenStart] = useState<number | null>(null);
  const [deleteZoneHovered, setDeleteZoneHovered] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  // Canonical invocation selection (URIP §16.2): the descriptor picked from the
  // catalog list. Validated against the typed text at send time; cleared when
  // editing moves away from its trigger.
  const selectedInvocableRef = useRef<InvocableDescriptor | undefined>(undefined);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

  const textareaRef = useRef<RichTextareaHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commandListRef = useRef<HTMLDivElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);

  // Composer plumbing, each in a focused hook (see features/chat/hooks):
  const availableViewportHeight = useViewportHeight();
  const { isComposing, handleCompositionStart, handleCompositionEnd } = useImeComposition();
  const {
    pendingDraftValueRef,
    pendingDraftAttachmentsRef,
    scheduleDraftPersistence,
    clearDraftPersistence,
  } = useComposerDraft(sessionId);
  const { workspaceSkills, loadWorkspaceSkills } = useWorkspaceSkills();
  const {
    mentionState,
    setMentionState,
    detectMention,
    parseQuery,
    fetchEntries,
    debouncedFetchEntries,
  } = useMentionState(mentionListRef);
  const {
    attachments,
    setAttachments,
    attachmentError,
    addFilesAsAttachments,
    handleFileSelect,
    removeAttachment,
    clearAttachments,
  } = useAttachmentPicker({
    fileInputRef,
    pendingAttachmentsRef: pendingDraftAttachmentsRef,
    scheduleDraftPersistence,
  });
  const { isDuplicateSubmission, recordSubmission, clearSubmission } = useDuplicateSendGuard();

  const expandedInputMaxHeight = Math.max(
    EXPANDED_INPUT_MIN_HEIGHT_PX,
    Math.min(Math.floor(availableViewportHeight * 0.4), 320)
  );
  const expandedInputHeight = Math.min(EXPANDED_INPUT_DEFAULT_HEIGHT_PX, expandedInputMaxHeight);

  // Update value and persist draft to store
  const updateValue = useCallback(
    (newValue: string) => {
      setValue(newValue);
      pendingDraftValueRef.current = newValue;
      scheduleDraftPersistence();
    },
    [scheduleDraftPersistence]
  );

  // Update value when initialValue changes (e.g., after cancel to restore previous message)
  useEffect(() => {
    if (initialValue !== undefined) {
      setValue(initialValue);
      pendingDraftValueRef.current = initialValue;
      // Focus textarea after setting value
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [initialValue]);

  // Update attachments when initialAttachments changes
  useEffect(() => {
    if (initialAttachments !== undefined) {
      setAttachments(initialAttachments);
      pendingDraftAttachmentsRef.current = initialAttachments;
    }
  }, [initialAttachments]);

  // Ids of currently-known skills — used to decide which `/name` tokens in the
  // textarea get highlighted (only real skills, not arbitrary `/path` text).
  const skillIds = useMemo(() => new Set(workspaceSkills.map(s => s.id)), [workspaceSkills]);
  // Full command strings (e.g. `/clear`, `/commit-commands:commit`) for the
  // same purpose — commands are highlighted in a different color than skills.
  const commandSet = useMemo(() => new Set(commands.map(c => c.command)), [commands]);

  // Delete a `/skill` or `/command` token (plus its trailing space) from the
  // composer text and restore the caret to where the token used to start.
  const handleDeleteToken = useCallback(
    (tokenStart: number) => {
      const result = deleteTokenAt(value, tokenStart, commandSet, skillIds);
      if (!result) return;
      updateValue(result.next);
      setHoveredTokenStart(null);
      setDeleteZoneHovered(false);
      // Restore the caret after React commits the new value (same setTimeout(0)
      // pattern as the other caret restores in this file — a rAF can fire
      // before the controlled value commits, leaving the caret at the end).
      setTimeout(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.setSelectionRange(result.caret, result.caret);
        el.focus();
      }, 0);
    },
    [value, commandSet, skillIds, updateValue]
  );

  const tokenInteraction: TokenInteraction = useMemo(
    () => ({
      hoveredTokenStart,
      onTokenHover: setHoveredTokenStart,
      onDeleteZoneHover: setDeleteZoneHovered,
      onDeleteToken: handleDeleteToken,
    }),
    [hoveredTokenStart, handleDeleteToken]
  );

  // Pinned skill refs on the active agent profile. Empty when there is no
  // profile (or before it loads). These are the source of truth for pin state;
  // the runtime already auto-loads them at session start (pi-runtime/skills.ts).
  const pinnedRefs = useMemo(
    () => agent?.skillSelection?.pinned ?? [],
    [agent?.skillSelection?.pinned]
  );
  const pinnedKeys = useMemo(() => new Set(pinnedRefs.map(ref => skillRefKey(ref))), [pinnedRefs]);

  const slashSuggestions = useSlashSuggestions({
    value,
    commands,
    workspaceSkills,
    pinnedKeys,
    invocableSuggestions,
  });

  // Auto-resize: grow from one line up to a cap, then scroll. Bidirectional —
  // resetting height to 'auto' before measuring lets it shrink as content is
  // deleted. rich-textarea's backdrop tracks the textarea size via ResizeObserver.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (isMobile) {
      const max = expandedInputHeight;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(
        COLLAPSED_CONTROL_SIZE_PX,
        Math.min(textarea.scrollHeight, max)
      )}px`;
      textarea.style.maxHeight = `${max}px`;
      textarea.style.overflowY = textarea.scrollHeight > max ? 'auto' : 'hidden';
      textarea.scrollTop = textarea.scrollHeight;
      return;
    }

    // Desktop: grow to ~40% of the viewport (capped 320px), then scroll.
    const max = Math.min(Math.floor(availableViewportHeight * 0.3), 200);
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, max)}px`;
    textarea.style.maxHeight = `${max}px`;
    textarea.style.overflowY = textarea.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, isMobile, expandedInputHeight, availableViewportHeight]);

  useEffect(() => {
    if (!isMobile) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    const keepLatestLineVisible = () => {
      textarea.scrollTop = textarea.scrollHeight;
    };

    textarea.addEventListener('focus', keepLatestLineVisible);
    return () => textarea.removeEventListener('focus', keepLatestLineVisible);
  }, [isMobile]);

  // Show/hide command suggestions
  useEffect(() => {
    if (value.startsWith('/') && slashSuggestions.length > 0 && !value.includes(' ')) {
      setShowCommands(true);
      setSelectedCommandIndex(0);
    } else {
      setShowCommands(false);
    }
  }, [value, slashSuggestions.length]);

  // Scroll selected command into view
  useEffect(() => {
    if (showCommands && commandListRef.current) {
      const selectedElement = commandListRef.current.querySelector(
        `[data-index="${selectedCommandIndex}"]`
      ) as HTMLElement | null;
      if (selectedElement?.scrollIntoView) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedCommandIndex, showCommands]);

  // Handle input change with @ detection
  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart || 0;

    updateValue(newValue);

    // Check for @ mention
    if (projectRoot) {
      const mention = detectMention(newValue, cursorPos);

      if (mention) {
        const { currentPath, searchQuery } = parseQuery(mention.query);

        setMentionState(prev => ({
          ...prev,
          isActive: true,
          isLoading: true,
          hasError: false,
          triggerIndex: mention.triggerIndex,
          query: mention.query,
          currentPath,
        }));

        debouncedFetchEntries(projectRoot, currentPath, searchQuery, backendId);
      } else if (mentionState.isActive) {
        setMentionState(initialMentionState);
      }
    }
  };

  // Select a file/directory entry
  const selectMentionEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.type === 'directory') {
        // Navigate into directory
        const newPath = entry.path;
        const before = value.substring(0, mentionState.triggerIndex);
        const after = value.substring(mentionState.triggerIndex + mentionState.query.length + 1);
        const newValue = `${before}@${newPath}/${after}`;

        updateValue(newValue);

        const newCursorPos = before.length + newPath.length + 2; // +2 for @ and /

        setMentionState(prev => ({
          ...prev,
          query: newPath + '/',
          currentPath: newPath,
          selectedIndex: 0,
        }));

        // Fetch new directory contents
        if (projectRoot) {
          fetchEntries(projectRoot, newPath, '', backendId);
        }

        // Set cursor position
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = newCursorPos;
            textareaRef.current.selectionEnd = newCursorPos;
            textareaRef.current.focus();
          }
        }, 0);
      } else {
        // Insert file reference
        const before = value.substring(0, mentionState.triggerIndex);
        const after = value.substring(mentionState.triggerIndex + mentionState.query.length + 1);
        const newValue = `${before}@${entry.path} ${after}`;

        updateValue(newValue);
        setMentionState(initialMentionState);

        // Move cursor after the inserted path
        const newCursorPos = before.length + entry.path.length + 2; // +2 for @ and space
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = newCursorPos;
            textareaRef.current.selectionEnd = newCursorPos;
            textareaRef.current.focus();
          }
        }, 0);
      }
    },
    [value, mentionState, projectRoot, backendId, fetchEntries]
  );

  // Navigate to a specific path (for breadcrumb navigation)
  const navigateToPath = useCallback(
    (path: string) => {
      const before = value.substring(0, mentionState.triggerIndex);
      const after = value.substring(mentionState.triggerIndex + mentionState.query.length + 1);
      const newQuery = path ? `${path}/` : '';
      const newValue = `${before}@${newQuery}${after}`;

      updateValue(newValue);

      setMentionState(prev => ({
        ...prev,
        query: newQuery,
        currentPath: path,
        selectedIndex: 0,
      }));

      if (projectRoot) {
        fetchEntries(projectRoot, path, '', backendId);
      }

      const newCursorPos = before.length + newQuery.length + 1;
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newCursorPos;
          textareaRef.current.selectionEnd = newCursorPos;
          textareaRef.current.focus();
        }
      }, 0);
    },
    [value, mentionState, projectRoot, backendId, fetchEntries]
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle @ mention selection
    if (mentionState.isActive && mentionState.entries.length > 0) {
      if (e.key === 'ArrowDown' || ((e.ctrlKey || e.metaKey) && e.key === 'n')) {
        e.preventDefault();
        setMentionState(prev => ({
          ...prev,
          selectedIndex: prev.selectedIndex < prev.entries.length - 1 ? prev.selectedIndex + 1 : 0,
        }));
        return;
      }
      if (e.key === 'ArrowUp' || ((e.ctrlKey || e.metaKey) && e.key === 'p')) {
        e.preventDefault();
        setMentionState(prev => ({
          ...prev,
          selectedIndex: prev.selectedIndex > 0 ? prev.selectedIndex - 1 : prev.entries.length - 1,
        }));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const selectedEntry = mentionState.entries[mentionState.selectedIndex];
        if (selectedEntry) {
          selectMentionEntry(selectedEntry);
        }
        return;
      }
      if (e.key === 'ArrowRight') {
        const selectedEntry = mentionState.entries[mentionState.selectedIndex];
        if (selectedEntry?.type === 'directory') {
          e.preventDefault();
          selectMentionEntry(selectedEntry);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionState(initialMentionState);
        return;
      }
    }

    // Handle command selection
    if (showCommands) {
      // ArrowDown or Ctrl+N/Cmd+N to move down
      if (e.key === 'ArrowDown' || ((e.ctrlKey || e.metaKey) && e.key === 'n')) {
        e.preventDefault();
        setSelectedCommandIndex(prev => (prev < slashSuggestions.length - 1 ? prev + 1 : 0));
        return;
      }
      // ArrowUp or Ctrl+P/Cmd+P to move up
      if (e.key === 'ArrowUp' || ((e.ctrlKey || e.metaKey) && e.key === 'p')) {
        e.preventDefault();
        setSelectedCommandIndex(prev => (prev > 0 ? prev - 1 : slashSuggestions.length - 1));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const selectedSuggestion = slashSuggestions[selectedCommandIndex];
        if (selectedSuggestion) {
          updateValue(selectedSuggestion.value + ' ');
          setShowCommands(false);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowCommands(false);
        return;
      }
    }

    // Enter key behavior (guarded by IME composition state).
    // Desktop: Enter sends, Shift+Enter inserts a newline.
    // Mobile: Enter is always a newline; sending is limited to the send button.
    if (e.key === 'Enter' && !isComposing && !e.nativeEvent.isComposing) {
      if (!isMobile && !e.shiftKey) {
        e.preventDefault();
        handleSend();
        return;
      }
    }

    // Escape to cancel loading
    if (e.key === 'Escape' && isLoading && onCancel) {
      e.preventDefault();
      onCancel();
      return;
    }

    // Cmd+V is handled by onPaste
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          await addFilesAsAttachments([file]);
        }
        return;
      }
    }
  };

  const handleSend = async () => {
    if (disabled) return;

    const trimmedValue = value.trim();
    const submissionKey = JSON.stringify({
      text: trimmedValue,
      attachments: attachments.map(attachment => attachment.id),
    });

    // Guard against duplicate mobile taps / synthetic click re-entry before
    // React clears the local input state.
    if (isDuplicateSubmission(submissionKey)) {
      return;
    }

    // ── Canonical invocation submission (URIP §16.3) ──
    // A catalog row picked from the menu records its canonical descriptor; the
    // submission stays canonical only while the text still matches the trigger
    // (editing the trigger clears the hidden selection). Otherwise the raw
    // text flows through the normal paths below.
    const selected = selectedInvocableRef.current;
    if (selected && onCanonicalInvocation && trimmedValue.startsWith('/')) {
      const trigger = selected.displayTrigger;
      if (trimmedValue === trigger || trimmedValue.startsWith(`${trigger} `)) {
        const invokeArgs =
          trimmedValue === trigger ? '' : trimmedValue.slice(trigger.length + 1).trim();
        recordSubmission(submissionKey);
        const sent = await onCanonicalInvocation(
          selected,
          invokeArgs,
          attachments.length > 0 ? attachments : undefined
        );
        if (!sent) {
          clearSubmission();
          return;
        }
        selectedInvocableRef.current = undefined;
        clearDraftPersistence();
        setValue('');
        clearDraft(sessionId);
        clearAttachments();
        return;
      }
      // Edited away from the trigger: the selection no longer matches.
      selectedInvocableRef.current = undefined;
    }

    // Handle slash commands
    if (trimmedValue.startsWith('/')) {
      const spaceIndex = trimmedValue.indexOf(' ');
      const command = spaceIndex > 0 ? trimmedValue.substring(0, spaceIndex) : trimmedValue;
      const args = spaceIndex > 0 ? trimmedValue.substring(spaceIndex + 1).trim() : '';

      // Only treat as command if it's a known command or a plugin command (contains ':')
      const isKnownCommand = commands.some(c => c.command === command);
      const namespace = command.slice(1).split(':', 1)[0];
      const isReservedNamespace =
        command.includes(':') &&
        (namespace === 'zc' ||
          namespace === 'skill' ||
          namespace === reservedRuntimeType ||
          namespace === agent?.runtimeType);
      const isPluginCommand = command.includes(':') && !!agent && !isReservedNamespace;

      if (onCommand && (isKnownCommand || isPluginCommand)) {
        recordSubmission(submissionKey);
        clearDraftPersistence();
        onCommand(command, args);
        setValue('');
        clearDraft(sessionId);
        return;
      }
    }

    // Send message with attachments
    if (trimmedValue || attachments.length > 0) {
      recordSubmission(submissionKey);
      clearDraftPersistence();
      onSend(trimmedValue, attachments.length > 0 ? attachments : undefined);
      if (trimmedValue.startsWith('/')) {
        void loadWorkspaceSkills();
      }
      setValue('');
      clearDraft(sessionId);
      clearAttachments();
    }
  };

  const selectSlashSuggestion = (suggestion: SlashSuggestion) => {
    if (suggestion.type === 'invocable' && suggestion.invocable) {
      // Canonical selection (§16.2): record the descriptor; the composer keeps
      // the editable trigger text. The selection is validated against the text
      // at send time — editing away from the trigger clears it.
      selectedInvocableRef.current = suggestion.invocable;
      updateValue(suggestion.value + ' ');
      setShowCommands(false);
      textareaRef.current?.focus();
      return;
    }
    updateValue(suggestion.value + ' ');
    setShowCommands(false);
    textareaRef.current?.focus();
  };

  // Toggle a skill's pin state on the active agent profile. Pins auto-load the
  // skill at session start (pi-runtime/skills.ts) and persist to agent_profiles
  // (hence sync across devices). Optimistically updates the local cache.
  const handleTogglePin = useCallback(
    async (ref: SkillRef, nextPinned: boolean) => {
      if (!agent) return;
      const key = skillRefKey(ref);
      const current = agent.skillSelection?.pinned ?? [];
      const pinned = nextPinned
        ? current.some(r => skillRefKey(r) === key)
          ? current
          : [...current, ref]
        : current.filter(r => skillRefKey(r) !== key);
      const nextSelection = { ...agent.skillSelection, pinned };
      try {
        await api.updateAgentProfile(agent.id, { skillSelection: nextSelection });
        useAgentProfileMetaStore.getState().invalidate(agent.id);
        await useAgentProfileMetaStore.getState().loadAll();
      } catch (err) {
        console.error('[MessageInput] failed to toggle skill pin:', err);
        // reload to revert optimistic state back to server truth
        useAgentProfileMetaStore.getState().invalidate(agent.id);
        void useAgentProfileMetaStore.getState().loadAll();
      }
    },
    [agent]
  );

  // Chip activation: insert the skill's slash command into the composer.
  const handleActivateChip = useCallback(
    (skillId: string) => {
      updateValue(`/${skillId} `);
      setShowCommands(false);
      textareaRef.current?.focus();
    },
    [updateValue]
  );

  // Reserved namespaces typed as raw text are resolved server-side (§12.2);
  // the pill offers the explicit "send literally" escape for this exact text.
  const showLiteralEscape =
    !!onSendLiterally && value.startsWith('/') && /^\/[A-Za-z][A-Za-z0-9_-]*:[^\s]*/.test(value);

  return (
    <div className="relative">
      {/* Cursor-style command/skill dropdown */}
      {showCommands && (
        <SlashMenu
          ref={commandListRef}
          suggestions={slashSuggestions}
          selectedIndex={selectedCommandIndex}
          pinEnabled={!!agent}
          onSelect={selectSlashSuggestion}
          onTogglePin={handleTogglePin}
        />
      )}

      {/* "Send literally" escape (§16.3): submit reserved-namespace text
          byte-for-byte instead of letting the server resolve it. */}
      {showLiteralEscape && (
        <button
          type="button"
          data-testid="send-literally"
          onClick={async () => {
            const sent = await onSendLiterally?.(
              value.trim(),
              attachments.length > 0 ? attachments : undefined
            );
            if (!sent) return;
            setValue('');
            clearDraft(sessionId);
            clearAttachments();
          }}
          className="absolute bottom-full left-0 mb-1 z-10 rounded-full border border-border bg-popover px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          Send literally — keep "/…" as plain text
        </button>
      )}

      {/* Resident pinned-skill chips (renders nothing when empty) */}
      <PinnedSkillChips
        pinnedRefs={pinnedRefs}
        skills={workspaceSkills}
        onActivate={handleActivateChip}
        onUnpin={ref => void handleTogglePin(ref, false)}
      />

      {/* @ Mention suggestions dropdown */}
      {mentionState.isActive && (
        <MentionMenu
          ref={mentionListRef}
          currentPath={mentionState.currentPath}
          entries={mentionState.entries}
          selectedIndex={mentionState.selectedIndex}
          isLoading={mentionState.isLoading}
          hasError={mentionState.hasError}
          onSelect={selectMentionEntry}
          onNavigate={navigateToPath}
        />
      )}

      {attachmentError && (
        <div
          role="alert"
          className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {attachmentError}
        </div>
      )}

      {/* Attachments preview */}
      <AttachmentPreviewList attachments={attachments} onRemove={removeAttachment} />

      {/* Input area */}
      {isMobile ? (
        /* Mobile: card-style two-row layout — textarea on top, buttons below */
        <div className="bg-input border border-border rounded-2xl px-3 pt-3 pb-2 mb-1">
          <RichTextarea
            data-testid="message-input"
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            disabled={disabled}
            placeholder={placeholder}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            rows={1}
            className="relative w-full resize-none min-h-[1.5rem] overflow-y-auto border-0 bg-transparent p-0 whitespace-pre-wrap break-words placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              fontSize: 'var(--chat-font-input, 0.8125rem)',
              width: '100%',
              maxHeight: `${Math.max(120, availableViewportHeight * 0.3)}px`,
              color: 'hsl(var(--foreground))',
              caretColor: 'hsl(var(--foreground))',
              // rich-textarea copies this padding to its backdrop and clips
              // paint at the box edge; 0.6em gives line-start token icons
              // room to paint. Wins over the p-0 class (inline style).
              paddingLeft: '0.6em',
              cursor: deleteZoneHovered ? 'pointer' : undefined,
            }}
          >
            {(v: string) => renderSkillTokens(v, skillIds, commandSet, tokenInteraction)}
          </RichTextarea>
          <div className="flex items-center gap-2 mt-2">
            {/* Attachment button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="h-11 w-11 md:h-10 md:w-10 flex-shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-full transition-colors disabled:opacity-50"
              title="Add attachment"
              aria-label="Attach file"
            >
              <Paperclip size={20} strokeWidth={1.75} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.json,.csv"
              onChange={handleFileSelect}
              className="hidden"
            />
            {mobileToolbarSlot}
            <div className="flex-1" />
            {/* Send/Cancel button */}
            {isLoading && onCancel ? (
              <button
                data-testid="cancel-button"
                onClick={onCancel}
                className="h-11 w-11 md:h-10 md:w-10 flex-shrink-0 flex items-center justify-center bg-foreground text-background hover:bg-foreground/90 rounded-full transition-colors"
                title="Cancel (Esc)"
                aria-label="Cancel"
              >
                <Square size={14} fill="currentColor" strokeWidth={0} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={disabled || (!value.trim() && attachments.length === 0)}
                className="h-11 w-11 md:h-10 md:w-10 flex-shrink-0 flex items-center justify-center bg-foreground text-background hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed rounded-full transition-colors"
                title="Send message"
                aria-label="Send message"
                data-testid="send-button"
              >
                <ArrowUp size={21} strokeWidth={2.25} />
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Desktop: one auto-growing composer. Single row at rest; grows
           line-by-line up to a viewport cap then scrolls. The row centers its
           content (items-center) so the single line is vertically centered,
           while +/send use self-end to stay pinned to the bottom as it grows. */
        <div
          data-testid="composer-box"
          className="flex items-center gap-2 rounded-2xl border border-border bg-input px-2.5 py-2 transition-colors duration-200 focus-within:border-primary/60 focus-within:shadow-apple-md"
        >
          {/* Attachment button */}
          <button
            data-testid="attach-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="flex h-8 w-8 flex-shrink-0 self-end items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            title="Add attachment (images, files)"
            aria-label="Attach file"
          >
            <Plus size={18} strokeWidth={1.75} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.json,.csv"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* flex + items-center centers rich-textarea's inline-block root
              (kills the inline-block baseline gap) so the single line is
              vertically centered; the +/send buttons use self-end to anchor
              to the bottom as the box grows. */}
          <div className="flex-1 relative flex items-center">
            <RichTextarea
              data-testid="message-input"
              ref={textareaRef}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              disabled={disabled}
              placeholder={placeholder}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              rows={1}
              className="relative block w-full resize-none border-0 bg-transparent p-0 leading-6 whitespace-pre-wrap break-words placeholder:text-muted-foreground/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                fontSize: 'var(--chat-font-input, 0.8125rem)',
                width: '100%',
                minHeight: '1.5rem',
                color: 'hsl(var(--foreground))',
                caretColor: 'hsl(var(--foreground))',
                paddingLeft: '0.6em',
                cursor: deleteZoneHovered ? 'pointer' : undefined,
              }}
            >
              {(v: string) => renderSkillTokens(v, skillIds, commandSet, tokenInteraction)}
            </RichTextarea>
          </div>

          {/* Send/Cancel button */}
          {isLoading && onCancel ? (
            <button
              data-testid="cancel-button"
              onClick={onCancel}
              className="flex h-8 w-8 flex-shrink-0 self-end items-center justify-center rounded-full bg-foreground text-background hover:bg-foreground/90"
              title="Cancel (Esc)"
              aria-label="Cancel"
            >
              <Square size={12} fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              data-testid="send-button"
              onClick={handleSend}
              disabled={disabled || (!value.trim() && attachments.length === 0)}
              className="flex h-8 w-8 flex-shrink-0 self-end items-center justify-center rounded-full bg-foreground text-background hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
              title="Send message (Enter)"
              aria-label="Send message"
            >
              <ArrowUp size={18} strokeWidth={2.25} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
