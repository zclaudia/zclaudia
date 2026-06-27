import type { ReactNode } from 'react';
import { Children, cloneElement, isValidElement } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  Brain,
  Bug,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Code2,
  Circle,
  Compass,
  Database,
  Download,
  Eye,
  FileText,
  Flame,
  FlaskConical,
  Folder,
  Globe,
  HardDrive,
  Heart,
  HelpCircle,
  Hourglass,
  Info,
  KeyRound,
  Lightbulb,
  Link,
  ListTodo,
  Lock,
  LockOpen,
  MessageCircle,
  Monitor,
  Package,
  PenLine,
  Pin,
  Plug,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  Shield,
  Sparkles,
  Star,
  Target,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  TrendingDown,
  TrendingUp,
  Upload,
  Wrench,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';

type InlineMarkdownIconDefinition = {
  Icon: LucideIcon;
  label: string;
  className: string;
  filled?: boolean;
};

const INLINE_MARKDOWN_ICONS: Record<string, InlineMarkdownIconDefinition> = {
  '☑️': { Icon: CheckCircle2, label: 'Completed', className: 'text-success' },
  '☑': { Icon: CheckCircle2, label: 'Completed', className: 'text-success' },
  '✅': { Icon: CheckCircle2, label: 'Completed', className: 'text-success' },
  '✔️': { Icon: CheckCircle2, label: 'Completed', className: 'text-success' },
  '✔': { Icon: CheckCircle2, label: 'Completed', className: 'text-success' },
  '❌': { Icon: XCircle, label: 'Error', className: 'text-destructive' },
  '✖️': { Icon: XCircle, label: 'Error', className: 'text-destructive' },
  '✖': { Icon: XCircle, label: 'Error', className: 'text-destructive' },
  '⛔': { Icon: XCircle, label: 'Blocked', className: 'text-destructive' },
  '🚫': { Icon: XCircle, label: 'Blocked', className: 'text-destructive' },
  '⚠️': { Icon: AlertTriangle, label: 'Warning', className: 'text-warning' },
  '⚠': { Icon: AlertTriangle, label: 'Warning', className: 'text-warning' },
  '❗': { Icon: AlertTriangle, label: 'Important', className: 'text-warning' },
  '❕': { Icon: AlertTriangle, label: 'Important', className: 'text-warning' },
  '❓': { Icon: HelpCircle, label: 'Question', className: 'text-muted-foreground' },
  '❔': { Icon: HelpCircle, label: 'Question', className: 'text-muted-foreground' },
  'ℹ️': { Icon: Info, label: 'Info', className: 'text-primary' },
  'ℹ': { Icon: Info, label: 'Info', className: 'text-primary' },
  '🔴': { Icon: Circle, label: 'P0', className: 'text-red-500', filled: true },
  '🟠': { Icon: Circle, label: 'P1', className: 'text-orange-500', filled: true },
  '🟡': { Icon: Circle, label: 'P2', className: 'text-yellow-500', filled: true },
  '🟢': { Icon: Circle, label: 'P3', className: 'text-green-500', filled: true },
  '🔵': { Icon: Circle, label: 'P4', className: 'text-blue-500', filled: true },
  '🟣': { Icon: Circle, label: 'Purple status', className: 'text-purple-500', filled: true },
  '🟤': { Icon: Circle, label: 'Brown status', className: 'text-amber-800 dark:text-amber-600', filled: true },
  '⚪': { Icon: Circle, label: 'White status', className: 'text-muted-foreground', filled: true },
  '⚫': { Icon: Circle, label: 'Black status', className: 'text-foreground', filled: true },
  '💬': { Icon: MessageCircle, label: 'Community chat', className: 'text-muted-foreground' },
  '🗨️': { Icon: MessageCircle, label: 'Comment', className: 'text-muted-foreground' },
  '🗨': { Icon: MessageCircle, label: 'Comment', className: 'text-muted-foreground' },
  '📚': { Icon: BookOpen, label: 'Documentation', className: 'text-emerald-600 dark:text-emerald-400' },
  '📖': { Icon: BookOpen, label: 'Documentation', className: 'text-emerald-600 dark:text-emerald-400' },
  '🔌': { Icon: Plug, label: 'Integration', className: 'text-muted-foreground' },
  '🐛': { Icon: Bug, label: 'Issue', className: 'text-yellow-600 dark:text-yellow-400' },
  '📊': { Icon: BarChart3, label: 'Stats', className: 'text-sky-600 dark:text-sky-400' },
  '📈': { Icon: TrendingUp, label: 'Trend up', className: 'text-success' },
  '📉': { Icon: TrendingDown, label: 'Trend down', className: 'text-destructive' },
  '📌': { Icon: Pin, label: 'Pinned', className: 'text-primary' },
  '🔍': { Icon: Search, label: 'Search', className: 'text-muted-foreground' },
  '🔎': { Icon: Search, label: 'Search', className: 'text-muted-foreground' },
  '📝': { Icon: PenLine, label: 'Note', className: 'text-primary' },
  '📋': { Icon: ClipboardList, label: 'Checklist', className: 'text-primary' },
  '📁': { Icon: Folder, label: 'Folder', className: 'text-amber-600 dark:text-amber-400' },
  '📂': { Icon: Folder, label: 'Folder', className: 'text-amber-600 dark:text-amber-400' },
  '🗂️': { Icon: Folder, label: 'Files', className: 'text-amber-600 dark:text-amber-400' },
  '🗂': { Icon: Folder, label: 'Files', className: 'text-amber-600 dark:text-amber-400' },
  '📄': { Icon: FileText, label: 'File', className: 'text-muted-foreground' },
  '📃': { Icon: FileText, label: 'File', className: 'text-muted-foreground' },
  '📦': { Icon: Package, label: 'Package', className: 'text-orange-600 dark:text-orange-400' },
  '🔧': { Icon: Wrench, label: 'Tool', className: 'text-muted-foreground' },
  '🛠️': { Icon: Wrench, label: 'Tools', className: 'text-muted-foreground' },
  '🛠': { Icon: Wrench, label: 'Tools', className: 'text-muted-foreground' },
  '⚙️': { Icon: Settings, label: 'Settings', className: 'text-muted-foreground' },
  '⚙': { Icon: Settings, label: 'Settings', className: 'text-muted-foreground' },
  '🚀': { Icon: Rocket, label: 'Launch', className: 'text-primary' },
  '⏳': { Icon: Hourglass, label: 'In progress', className: 'text-muted-foreground' },
  '⌛': { Icon: Hourglass, label: 'Waiting', className: 'text-muted-foreground' },
  '🕒': { Icon: Clock3, label: 'Time', className: 'text-muted-foreground' },
  '📅': { Icon: Calendar, label: 'Date', className: 'text-muted-foreground' },
  '🧪': { Icon: FlaskConical, label: 'Experiment', className: 'text-purple-600 dark:text-purple-400' },
  '💡': { Icon: Lightbulb, label: 'Idea', className: 'text-yellow-500' },
  '🧠': { Icon: Brain, label: 'Thinking', className: 'text-thinking' },
  '🔒': { Icon: Lock, label: 'Locked', className: 'text-muted-foreground' },
  '🔐': { Icon: Lock, label: 'Secure', className: 'text-muted-foreground' },
  '🔓': { Icon: LockOpen, label: 'Unlocked', className: 'text-muted-foreground' },
  '🔑': { Icon: KeyRound, label: 'Key', className: 'text-muted-foreground' },
  '🛡️': { Icon: Shield, label: 'Protected', className: 'text-primary' },
  '🛡': { Icon: Shield, label: 'Protected', className: 'text-primary' },
  '👀': { Icon: Eye, label: 'Review', className: 'text-muted-foreground' },
  '🎯': { Icon: Target, label: 'Target', className: 'text-red-500' },
  '✨': { Icon: Sparkles, label: 'Highlight', className: 'text-primary' },
  '⭐': { Icon: Star, label: 'Star', className: 'text-yellow-500', filled: true },
  '❤️': { Icon: Heart, label: 'Favorite', className: 'text-red-500', filled: true },
  '❤': { Icon: Heart, label: 'Favorite', className: 'text-red-500', filled: true },
  '🔥': { Icon: Flame, label: 'Hot', className: 'text-orange-500' },
  '⚡': { Icon: Zap, label: 'Fast', className: 'text-yellow-500' },
  '🔄': { Icon: RefreshCw, label: 'Refresh', className: 'text-muted-foreground' },
  '⬆️': { Icon: Upload, label: 'Upload', className: 'text-muted-foreground' },
  '⬆': { Icon: Upload, label: 'Upload', className: 'text-muted-foreground' },
  '⬇️': { Icon: Download, label: 'Download', className: 'text-muted-foreground' },
  '⬇': { Icon: Download, label: 'Download', className: 'text-muted-foreground' },
  '🌐': { Icon: Globe, label: 'Web', className: 'text-primary' },
  '🔗': { Icon: Link, label: 'Link', className: 'text-primary' },
  '💻': { Icon: Monitor, label: 'Computer', className: 'text-muted-foreground' },
  '🖥️': { Icon: Monitor, label: 'Computer', className: 'text-muted-foreground' },
  '🖥': { Icon: Monitor, label: 'Computer', className: 'text-muted-foreground' },
  '⌨️': { Icon: Terminal, label: 'Keyboard', className: 'text-muted-foreground' },
  '⌨': { Icon: Terminal, label: 'Keyboard', className: 'text-muted-foreground' },
  '🧭': { Icon: Compass, label: 'Navigation', className: 'text-muted-foreground' },
  '💾': { Icon: HardDrive, label: 'Save', className: 'text-muted-foreground' },
  '🗄️': { Icon: Database, label: 'Database', className: 'text-muted-foreground' },
  '🗄': { Icon: Database, label: 'Database', className: 'text-muted-foreground' },
  '💽': { Icon: Database, label: 'Storage', className: 'text-muted-foreground' },
  '🔔': { Icon: Bell, label: 'Notification', className: 'text-muted-foreground' },
  '👍': { Icon: ThumbsUp, label: 'Approved', className: 'text-success' },
  '👎': { Icon: ThumbsDown, label: 'Rejected', className: 'text-destructive' },
  '🧾': { Icon: ListTodo, label: 'Tasks', className: 'text-primary' },
  '🧑‍💻': { Icon: Code2, label: 'Developer', className: 'text-muted-foreground' },
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const INLINE_MARKDOWN_ICON_TOKENS = Object.keys(INLINE_MARKDOWN_ICONS)
  .sort((a, b) => b.length - a.length);
const INLINE_MARKDOWN_ICON_PATTERN = INLINE_MARKDOWN_ICON_TOKENS
  .map(escapeRegex)
  .join('|');
const EMOJI_FALLBACK_PATTERN = String.raw`(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\uFE0E|\p{Emoji_Modifier})*(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E|\p{Emoji_Modifier})*)*)`;
const INLINE_MARKDOWN_EMOJI_PATTERN = INLINE_MARKDOWN_ICON_PATTERN
  ? `(?:${INLINE_MARKDOWN_ICON_PATTERN})|(?:${EMOJI_FALLBACK_PATTERN})`
  : EMOJI_FALLBACK_PATTERN;
const INLINE_MARKDOWN_ICON_REGEX = new RegExp(INLINE_MARKDOWN_EMOJI_PATTERN, 'gu');
const INLINE_MARKDOWN_ICON_TEST_REGEX = new RegExp(INLINE_MARKDOWN_EMOJI_PATTERN, 'u');

export function hasInlineMarkdownIcon(text: string): boolean {
  return INLINE_MARKDOWN_ICON_TEST_REGEX.test(text);
}

function InlineMarkdownIcon({ symbol }: { symbol: string }) {
  const definition = INLINE_MARKDOWN_ICONS[symbol];
  if (!definition) {
    return (
      <span
        aria-label={symbol}
        role="img"
        className="inline-markdown-emoji"
      >
        {symbol}
      </span>
    );
  }

  const { Icon, label, className, filled } = definition;
  return (
    <Icon
      aria-label={label}
      role="img"
      className={`inline-block h-[1em] w-[1em] align-[-0.125em] ${className}`}
      fill={filled ? 'currentColor' : 'none'}
      strokeWidth={filled ? 1.75 : 2}
    />
  );
}

export function pushTextWithInlineMarkdownIcons(parts: ReactNode[], text: string, keyPrefix: string) {
  if (!text) return;
  if (!hasInlineMarkdownIcon(text)) {
    parts.push(text);
    return;
  }

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_MARKDOWN_ICON_REGEX.lastIndex = 0;

  while ((match = INLINE_MARKDOWN_ICON_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    parts.push(
      <InlineMarkdownIcon
        key={`${keyPrefix}-icon-${match.index}-${match[0]}`}
        symbol={match[0]}
      />
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
}

export function TextWithInlineMarkdownIcons({ text }: { text: string }) {
  if (!hasInlineMarkdownIcon(text)) return <>{text}</>;

  const parts: ReactNode[] = [];
  pushTextWithInlineMarkdownIcons(parts, text, 'inline');
  return <>{parts}</>;
}

function replaceInlineMarkdownIcons(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string' && hasInlineMarkdownIcon(child)) {
      return <TextWithInlineMarkdownIcons text={child} />;
    }

    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children) {
      if (child.type === 'code' || child.type === 'pre') return child;
      return cloneElement(child, {
        children: replaceInlineMarkdownIcons(child.props.children),
      });
    }

    return child;
  });
}

export function MarkdownChildrenWithInlineIcons({ children }: { children: ReactNode }) {
  return <>{replaceInlineMarkdownIcons(children)}</>;
}
