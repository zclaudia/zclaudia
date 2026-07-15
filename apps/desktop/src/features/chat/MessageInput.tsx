import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { KeyboardEvent, ClipboardEvent, ChangeEvent } from 'react';
import {
  ArrowUp,
  Paperclip,
  X,
  Square,
  File as FileIcon,
  ChevronRight,
  Plus,
  FolderClosed,
} from 'lucide-react';
import { Icon } from '../../components/ui/Icon';
import { FileSymbol } from '../../components/filesymbols';
import type { SlashCommand, FileEntry, SkillRef } from '@zclaudia/shared';
import { skillRefKey, validateMessageAttachmentFiles } from '@zclaudia/shared';
import * as api from '../../services/api';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useComposerStore, type SessionDraft } from '../../stores/composerStore';
import { useAgentProfileMetaStore } from '../../stores/agentProfileMetaStore';
import { useAgentForSession } from '../../hooks/useAgentForSession';
import type { WorkspaceSkillInfo } from '../../services/api/workspace-skills';
import { downscaleImageFile } from '../attachments/downscale-image';
import { SlashMenu, type SlashSuggestion } from './SlashMenu';
import { PinnedSkillChips } from './PinnedSkillChips';
import { RichTextarea, type RichTextareaHandle } from 'rich-textarea';
import { renderSkillTokens, deleteTokenAt, type TokenInteraction } from './SkillTokenRenderer';

export interface Attachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  data: string; // base64 data URL
  mimeType: string;
}

interface MessageInputProps {
  sessionId: string; // Session ID for draft persistence
  onSend: (message: string, attachments?: Attachment[]) => void;
  onCancel?: () => void;
  onCommand?: (command: string, args: string) => void;
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

// State for @ mention feature
interface MentionState {
  isActive: boolean;
  triggerIndex: number;
  query: string;
  currentPath: string;
  entries: FileEntry[];
  selectedIndex: number;
  isLoading: boolean;
  hasError: boolean;
}

const initialMentionState: MentionState = {
  isActive: false,
  triggerIndex: -1,
  query: '',
  currentPath: '',
  entries: [],
  selectedIndex: 0,
  isLoading: false,
  hasError: false,
};

const DRAFT_PERSIST_DEBOUNCE_MS = 300;
const COLLAPSED_CONTROL_SIZE_PX = 48;
const EXPANDED_INPUT_DEFAULT_HEIGHT_PX = 160;
const EXPANDED_INPUT_MIN_HEIGHT_PX = 120;
const DUPLICATE_SEND_GUARD_MS = 400;

// Format file size
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

// Simple debounce function
function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function MessageInput({
  sessionId,
  onSend,
  onCancel,
  onCommand,
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
  const getAvailableViewportHeight = useCallback(() => {
    if (typeof window === 'undefined') return 800;
    return window.visualViewport?.height ?? window.innerHeight;
  }, []);
  const isMobile = useIsMobile();
  const setDraft = useComposerStore(s => s.setDraft);
  const clearDraft = useComposerStore(s => s.clearDraft);
  const { agent } = useAgentForSession(sessionId);
  const [value, setValue] = useState('');
  const [hoveredTokenStart, setHoveredTokenStart] = useState<number | null>(null);
  const [deleteZoneHovered, setDeleteZoneHovered] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [workspaceSkills, setWorkspaceSkills] = useState<WorkspaceSkillInfo[]>([]);
  const [mentionState, setMentionState] = useState<MentionState>(initialMentionState);
  const [isComposing, setIsComposing] = useState(false); // Track IME composition state
  const [availableViewportHeight, setAvailableViewportHeight] = useState(
    getAvailableViewportHeight
  );
  const expandedInputMaxHeight = Math.max(
    EXPANDED_INPUT_MIN_HEIGHT_PX,
    Math.min(Math.floor(availableViewportHeight * 0.4), 320)
  );
  const expandedInputHeight = Math.min(EXPANDED_INPUT_DEFAULT_HEIGHT_PX, expandedInputMaxHeight);

  const textareaRef = useRef<RichTextareaHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commandListRef = useRef<HTMLDivElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const compositionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftPersistTimeoutRef = useRef<number | null>(null);
  const pendingDraftValueRef = useRef('');
  const pendingDraftAttachmentsRef = useRef<Attachment[]>([]);
  const lastSubmissionRef = useRef<{ key: string; at: number } | null>(null);

  const getPendingDraft = useCallback(
    (): SessionDraft => ({
      content: pendingDraftValueRef.current,
      attachments: pendingDraftAttachmentsRef.current,
    }),
    []
  );

  const flushDraftPersistence = useCallback(() => {
    if (draftPersistTimeoutRef.current) {
      clearTimeout(draftPersistTimeoutRef.current);
      draftPersistTimeoutRef.current = null;
    }

    setDraft(sessionId, getPendingDraft());
  }, [getPendingDraft, sessionId, setDraft]);

  const clearDraftPersistence = useCallback(() => {
    if (draftPersistTimeoutRef.current) {
      clearTimeout(draftPersistTimeoutRef.current);
      draftPersistTimeoutRef.current = null;
    }
    pendingDraftValueRef.current = '';
    pendingDraftAttachmentsRef.current = [];
  }, []);

  const scheduleDraftPersistence = useCallback(() => {
    if (draftPersistTimeoutRef.current) {
      clearTimeout(draftPersistTimeoutRef.current);
    }

    draftPersistTimeoutRef.current = window.setTimeout(() => {
      draftPersistTimeoutRef.current = null;
      setDraft(sessionId, getPendingDraft());
    }, DRAFT_PERSIST_DEBOUNCE_MS);
  }, [getPendingDraft, sessionId, setDraft]);

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

  // Cleanup composition timeout on unmount
  useEffect(() => {
    return () => {
      if (compositionTimeoutRef.current) {
        clearTimeout(compositionTimeoutRef.current);
      }
      if (draftPersistTimeoutRef.current) {
        flushDraftPersistence();
      }
    };
  }, [flushDraftPersistence]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateViewportHeight = () => {
      setAvailableViewportHeight(getAvailableViewportHeight());
    };

    const viewport = window.visualViewport;
    updateViewportHeight();

    window.addEventListener('resize', updateViewportHeight);
    viewport?.addEventListener('resize', updateViewportHeight);
    viewport?.addEventListener('scroll', updateViewportHeight);

    return () => {
      window.removeEventListener('resize', updateViewportHeight);
      viewport?.removeEventListener('resize', updateViewportHeight);
      viewport?.removeEventListener('scroll', updateViewportHeight);
    };
  }, [getAvailableViewportHeight]);

  const loadWorkspaceSkills = useCallback(async () => {
    try {
      const result = await api.getWorkspaceSkillsResult();
      setWorkspaceSkills(result.skills ?? []);
    } catch {
      setWorkspaceSkills([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getWorkspaceSkillsResult()
      .then(result => {
        if (!cancelled) setWorkspaceSkills(result.skills ?? []);
      })
      .catch(() => {
        if (!cancelled) setWorkspaceSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      setValue(result.next);
      setHoveredTokenStart(null);
      setDeleteZoneHovered(false);
      // Restore the caret after React commits the new value.
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.setSelectionRange(result.caret, result.caret);
        el.focus();
      });
    },
    [value, commandSet, skillIds]
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

  // Filter commands based on input (memoized to avoid O(n) filter on every render)
  const slashSuggestions = useMemo<SlashSuggestion[]>(() => {
    if (!value.startsWith('/') || value.includes(' ')) return [];
    const query = value.toLowerCase();
    const skillSuggestions: SlashSuggestion[] = workspaceSkills
      .filter(skill => skill.eligible !== false && skill.metadata?.userInvocable !== false)
      .filter(skill => `/${skill.id}`.toLowerCase().startsWith(query))
      .map((skill): SlashSuggestion => {
        const ref: SkillRef = { source: skill.source ?? 'workspace', id: skill.id };
        return {
          index: 0, // reassigned below after ordering
          type: 'skill',
          value: `/${skill.id}`,
          description: skill.metadata?.whenToUse || skill.description,
          argumentHint: skill.metadata?.argumentHint || skill.metadata?.arguments?.join(' '),
          usageCount: skill.usage?.count,
          source: skill.source ?? 'workspace',
          mode: skill.execution?.defaultMode,
          pinned: pinnedKeys.has(skillRefKey(ref)),
          skillRef: ref,
        };
      });
    const commandSuggestions: SlashSuggestion[] = commands
      .filter(cmd => cmd.command.toLowerCase().startsWith(query))
      .map(
        (cmd): SlashSuggestion => ({
          index: 0,
          type: 'command',
          value: cmd.command,
          description: cmd.description,
        })
      );
    // Order: pinned skills first, then remaining skills by usage desc, then
    // commands. Reassign contiguous indices so keyboard-nav + scroll-into-view
    // stay aligned across the visual groups rendered by SlashMenu.
    return [...skillSuggestions, ...commandSuggestions]
      .sort((a, b) => {
        const pa = a.type === 'skill' && a.pinned ? 1 : 0;
        const pb = b.type === 'skill' && b.pinned ? 1 : 0;
        if (pa !== pb) return pb - pa;
        if (a.type !== 'skill' || b.type !== 'skill') return 0;
        const ua = a.usageCount ?? 0;
        const ub = b.usageCount ?? 0;
        return ub - ua;
      })
      .map((s, index) => ({ ...s, index }));
  }, [value, commands, workspaceSkills, pinnedKeys]);

  // Detect @ mention in text
  const detectMention = useCallback(
    (text: string, cursorPos: number): { triggerIndex: number; query: string } | null => {
      // Find the last @ before cursor that's not preceded by a non-space character
      for (let i = cursorPos - 1; i >= 0; i--) {
        const char = text[i];
        if (char === '@') {
          // Check if @ is at start or preceded by whitespace
          if (i === 0 || /\s/.test(text[i - 1])) {
            return {
              triggerIndex: i,
              query: text.substring(i + 1, cursorPos),
            };
          }
          break;
        }
        // Stop if we hit whitespace (except within the path)
        if (char === ' ' || char === '\n' || char === '\t') {
          break;
        }
      }
      return null;
    },
    []
  );

  // Parse query into path components
  const parseQuery = useCallback((query: string) => {
    const pathParts = query.split('/');
    const currentPath = pathParts.slice(0, -1).join('/');
    const searchQuery = pathParts[pathParts.length - 1];
    return { currentPath, searchQuery };
  }, []);

  // Fetch directory entries with debouncing
  const fetchEntries = useCallback(
    async (
      projectRootPath: string,
      relativePath: string,
      query: string,
      resolvedBackendId?: string | null
    ) => {
      if (!projectRootPath) return;

      setMentionState(prev => ({ ...prev, isLoading: true, hasError: false }));

      try {
        const result = await api.listDirectory({
          projectRoot: projectRootPath,
          relativePath,
          query,
          maxResults: 20,
          backendId: resolvedBackendId,
        });

        setMentionState(prev => ({
          ...prev,
          entries: result.entries,
          isLoading: false,
          selectedIndex: 0,
        }));
      } catch (error) {
        console.error('Failed to fetch directory listing:', error);
        setMentionState(prev => ({ ...prev, entries: [], isLoading: false, hasError: true }));
      }
    },
    []
  );

  // Debounced fetch
  const debouncedFetchEntries = useMemo(() => debounce(fetchEntries, 150), [fetchEntries]);

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

  // Scroll selected mention into view
  useEffect(() => {
    if (mentionState.isActive && mentionListRef.current) {
      const selectedElement = mentionListRef.current.querySelector(
        `[data-index="${mentionState.selectedIndex}"]`
      ) as HTMLElement;
      if (selectedElement?.scrollIntoView) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [mentionState.selectedIndex, mentionState.isActive]);

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

  const readFileAsAttachment = async (file: File): Promise<void> => {
    if (file.type.startsWith('image/')) {
      file = await downscaleImageFile(file);
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const attachment: Attachment = {
          id: crypto.randomUUID(),
          type: file.type.startsWith('image/') ? 'image' : 'file',
          name: file.name,
          data: reader.result as string,
          mimeType: file.type,
        };
        setAttachments(prev => {
          const nextAttachments = [...prev, attachment];
          pendingDraftAttachmentsRef.current = nextAttachments;
          scheduleDraftPersistence();
          return nextAttachments;
        });
        resolve();
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });
  };

  const addFilesAsAttachments = async (files: File[]): Promise<void> => {
    const validation = validateMessageAttachmentFiles(files, {
      existingCount: pendingDraftAttachmentsRef.current.length,
    });

    if (validation.rejected.length > 0) {
      setAttachmentError(validation.rejected.map(issue => issue.message).join(' '));
    } else {
      setAttachmentError(null);
    }

    for (const file of validation.accepted) {
      try {
        await readFileAsAttachment(file);
        setAttachmentError(null);
      } catch {
        setAttachmentError(`Failed to read "${file.name}".`);
      }
    }
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    await addFilesAsAttachments(Array.from(files));

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => {
      const nextAttachments = prev.filter(a => a.id !== id);
      pendingDraftAttachmentsRef.current = nextAttachments;
      scheduleDraftPersistence();
      return nextAttachments;
    });
  };

  const handleSend = () => {
    if (disabled) return;

    const trimmedValue = value.trim();
    const submissionKey = JSON.stringify({
      text: trimmedValue,
      attachments: attachments.map(attachment => attachment.id),
    });
    const lastSubmission = lastSubmissionRef.current;

    // Guard against duplicate mobile taps / synthetic click re-entry before
    // React clears the local input state.
    if (
      lastSubmission &&
      lastSubmission.key === submissionKey &&
      Date.now() - lastSubmission.at < DUPLICATE_SEND_GUARD_MS
    ) {
      return;
    }

    // Handle slash commands
    if (trimmedValue.startsWith('/')) {
      const spaceIndex = trimmedValue.indexOf(' ');
      const command = spaceIndex > 0 ? trimmedValue.substring(0, spaceIndex) : trimmedValue;
      const args = spaceIndex > 0 ? trimmedValue.substring(spaceIndex + 1).trim() : '';

      // Only treat as command if it's a known command or a plugin command (contains ':')
      const isKnownCommand = commands.some(c => c.command === command);
      const isPluginCommand = command.includes(':');

      if (onCommand && (isKnownCommand || isPluginCommand)) {
        lastSubmissionRef.current = { key: submissionKey, at: Date.now() };
        clearDraftPersistence();
        onCommand(command, args);
        setValue('');
        clearDraft(sessionId);
        return;
      }
    }

    // Send message with attachments
    if (trimmedValue || attachments.length > 0) {
      lastSubmissionRef.current = { key: submissionKey, at: Date.now() };
      clearDraftPersistence();
      onSend(trimmedValue, attachments.length > 0 ? attachments : undefined);
      if (trimmedValue.startsWith('/')) {
        void loadWorkspaceSkills();
      }
      setValue('');
      clearDraft(sessionId);
      setAttachments([]);
      setAttachmentError(null);
      pendingDraftAttachmentsRef.current = [];
    }
  };

  const selectSlashSuggestion = (suggestion: SlashSuggestion) => {
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

      {/* Resident pinned-skill chips (renders nothing when empty) */}
      <PinnedSkillChips
        pinnedRefs={pinnedRefs}
        skills={workspaceSkills}
        onActivate={handleActivateChip}
        onUnpin={ref => void handleTogglePin(ref, false)}
      />

      {/* @ Mention suggestions dropdown */}
      {mentionState.isActive && (
        <div
          ref={mentionListRef}
          className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-lg shadow-lg overflow-y-auto max-h-64 z-10"
        >
          {/* Breadcrumb navigation */}
          {mentionState.currentPath && (
            <div className="px-4 py-2 border-b border-border text-sm text-muted-foreground flex items-center gap-1 flex-wrap">
              <button onClick={() => navigateToPath('')} className="hover:text-foreground">
                root
              </button>
              {mentionState.currentPath.split('/').map((part, idx, arr) => (
                <span key={idx} className="flex items-center gap-1">
                  <span className="text-muted-foreground/50">/</span>
                  <button
                    onClick={() => navigateToPath(arr.slice(0, idx + 1).join('/'))}
                    className="hover:text-foreground"
                  >
                    {part}
                  </button>
                </span>
              ))}
            </div>
          )}

          {mentionState.isLoading ? (
            <div className="px-4 py-3 text-muted-foreground text-sm">Loading...</div>
          ) : mentionState.hasError ? (
            <div className="px-4 py-3 text-destructive text-sm">
              Failed to list files — check server connection
            </div>
          ) : mentionState.entries.length === 0 ? (
            <div className="px-4 py-3 text-muted-foreground text-sm">No files found</div>
          ) : (
            mentionState.entries.map((entry, index) => (
              <button
                key={entry.path}
                data-index={index}
                onClick={() => selectMentionEntry(entry)}
                className={`w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-muted ${
                  index === mentionState.selectedIndex ? 'bg-muted' : ''
                }`}
              >
                {entry.type === 'directory' ? (
                  <Icon icon={FolderClosed} size={16} className="text-muted-foreground" />
                ) : (
                  <FileSymbol name={entry.name} size={16} />
                )}
                <span className="flex-1 truncate">{entry.name}</span>
                {entry.type === 'directory' && (
                  <ChevronRight size={14} className="text-muted-foreground" />
                )}
                {entry.size !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    {formatFileSize(entry.size)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
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
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 p-2 bg-muted rounded-lg">
          {attachments.map(attachment => (
            <div
              key={attachment.id}
              className="relative group bg-secondary rounded-lg overflow-hidden"
            >
              {attachment.type === 'image' ? (
                <img
                  src={attachment.data}
                  alt={attachment.name}
                  className="h-20 w-auto max-w-32 object-cover"
                />
              ) : (
                <div className="h-20 w-32 flex items-center justify-center p-2">
                  <div className="text-center">
                    <FileIcon
                      size={32}
                      strokeWidth={1.5}
                      className="mx-auto text-muted-foreground"
                    />
                    <span className="text-xs text-muted-foreground truncate block mt-1">
                      {attachment.name}
                    </span>
                  </div>
                </div>
              )}
              <button
                onClick={() => removeAttachment(attachment.id)}
                className="absolute top-1 right-1 w-7 h-7 md:w-6 md:h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity before:absolute before:-inset-2 before:content-[''] md:before:content-none"
                aria-label={`Remove attachment ${attachment.name}`}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}

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
            onCompositionStart={() => {
              if (compositionTimeoutRef.current) {
                clearTimeout(compositionTimeoutRef.current);
                compositionTimeoutRef.current = null;
              }
              setIsComposing(true);
            }}
            onCompositionEnd={() => {
              compositionTimeoutRef.current = setTimeout(() => {
                setIsComposing(false);
                compositionTimeoutRef.current = null;
              }, 50);
            }}
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
              // paint at the box edge; 0.5em gives line-start token icons
              // room to paint. Wins over the p-0 class (inline style).
              paddingLeft: '0.5em',
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
              onCompositionStart={() => {
                if (compositionTimeoutRef.current) {
                  clearTimeout(compositionTimeoutRef.current);
                  compositionTimeoutRef.current = null;
                }
                setIsComposing(true);
              }}
              onCompositionEnd={() => {
                compositionTimeoutRef.current = setTimeout(() => {
                  setIsComposing(false);
                  compositionTimeoutRef.current = null;
                }, 50);
              }}
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
                paddingLeft: '0.5em',
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
