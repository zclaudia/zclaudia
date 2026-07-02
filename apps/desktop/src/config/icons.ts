/**
 * Unified icon configuration for the application.
 * Uses Lucide React icons (closest to Apple SF Symbols on the web).
 */
import {
  FileText,
  Pencil,
  FileEdit,
  Terminal,
  Search,
  FolderSearch,
  ClipboardList,
  Globe,
  SearchCode,
  HelpCircle,
  CheckSquare,
  BookOpen,
  ClipboardCheck,
  Wrench,
  Code2,
  // Status
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  RefreshCw,
  Pause,
  // System
  Cpu,
  Package,
  Shield,
  Key,
  Folder,
  Monitor,
  Users,
  // Message
  Bot,
  User,
  Cog,
  type LucideIcon,
} from 'lucide-react';

export type { LucideIcon };

export const ICONS = {
  // Tool icons — used in ToolCallItem component
  tools: {
    Read: FileText,
    Write: Pencil,
    Edit: FileEdit,
    MultiEdit: FileEdit,
    ReadSymbol: Code2,
    EditSymbol: FileEdit,
    Bash: Terminal,
    Grep: Search,
    Glob: FolderSearch,
    Task: ClipboardList,
    WebFetch: Globe,
    WebSearch: SearchCode,
    AskUserQuestion: HelpCircle,
    TodoWrite: CheckSquare,
    NotebookEdit: BookOpen,
    ExitPlanMode: ClipboardCheck,
    EnterPlanMode: ClipboardList,
    default: Wrench,
  },

  // System info icons — used in SystemInfoPanel and the session-header info popover
  systemInfo: {
    model: Cpu,
    version: Package,
    permission: Shield,
    apiKey: Key,
    cwd: Folder,
    tools: Wrench,
    mcpServers: Monitor,
    slashCommands: Terminal,
    agents: Users,
    info: Info,
  },

  // Status icons — used across various components
  status: {
    loading: Loader2,
    success: CheckCircle2,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
    running: RefreshCw,
    pending: Pause,
  },

  // Message icons — used in LoadingIndicator and message display
  message: {
    assistant: Bot,
    user: User,
    system: Cog,
  },
} as const;

// Type exports for type-safe icon access
export type ToolIconKey = keyof typeof ICONS.tools;
export type StatusIconKey = keyof typeof ICONS.status;

// Helper functions — return LucideIcon components
export function getToolIcon(toolName: string): LucideIcon {
  return ICONS.tools[toolName as ToolIconKey] || ICONS.tools.default;
}

export function getStatusIcon(status: string): LucideIcon {
  return ICONS.status[status as StatusIconKey] || ICONS.status.info;
}
