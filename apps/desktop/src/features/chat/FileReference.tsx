import type { ReactNode } from 'react';
import { Children, cloneElement, isValidElement } from 'react';
import {
  hasInlineMarkdownIcon,
  pushTextWithInlineMarkdownIcons,
  TextWithInlineMarkdownIcons,
} from '../../components/markdown/InlineMarkdownIcons';
import { FileSymbol } from '../../components/filesymbols';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { useProjectStore } from '../../stores/projectStore';
import { activatePanel } from '../../utils/openPanel';

/**
 * Regex to match @file references in text.
 * Matches @followed by a path-like string (letters, numbers, /, ., -, _, etc.)
 * Must start after whitespace or at beginning of text.
 */
const FILE_REF_REGEX = /(^|[\s(])(@[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/g;
const FILE_REF_TEST_REGEX = /@[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+/;

function pushTextPart(
  parts: ReactNode[],
  text: string,
  replaceEmojiIcons: boolean,
  keyPrefix: string
) {
  if (!text) return;
  if (replaceEmojiIcons) {
    pushTextWithInlineMarkdownIcons(parts, text, keyPrefix);
    return;
  }
  parts.push(text);
}

/**
 * Parse text content and render @file references as clickable links.
 * Non-matching text is rendered as-is.
 */
export function TextWithFileRefs({
  text,
  variant = 'default',
  replaceEmojiIcons = false,
}: {
  text: string;
  variant?: 'default' | 'user';
  replaceEmojiIcons?: boolean;
}) {
  const openFile = useFileViewerStore(s => s.openFile);
  const projects = useProjectStore(s => s.projects);

  const handleClick = (filePath: string) => {
    // Find project root from the first project with a rootPath
    const project = Object.values(projects).find(p => p.rootPath);
    if (project?.rootPath) {
      openFile(project.rootPath, filePath);
      activatePanel('file-viewer');
    }
  };

  const refClassName =
    variant === 'user'
      ? 'font-mono inline rounded-md px-1 py-0.5 border border-primary-foreground/40 bg-primary-foreground/20 text-foreground hover:bg-primary-foreground/30 hover:underline cursor-pointer'
      : 'text-primary hover:underline cursor-pointer font-mono inline';

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state
  FILE_REF_REGEX.lastIndex = 0;

  while ((match = FILE_REF_REGEX.exec(text)) !== null) {
    const prefix = match[1]; // whitespace or start
    const ref = match[2]; // @path/to/file.ext
    const fullMatchStart = match.index;

    // Add text before this match (including the prefix whitespace)
    if (fullMatchStart > lastIndex) {
      pushTextPart(parts, text.slice(lastIndex, fullMatchStart), replaceEmojiIcons, `${lastIndex}`);
    }

    // Add the prefix (whitespace)
    if (prefix) {
      pushTextPart(parts, prefix, replaceEmojiIcons, `${fullMatchStart}-prefix`);
    }

    // Add clickable reference
    const filePath = ref.slice(1); // remove @
    const basename = filePath.split('/').pop() ?? filePath;
    parts.push(
      <button
        key={`${fullMatchStart}-${filePath}`}
        onClick={() => handleClick(filePath)}
        className={refClassName}
        title={`View ${filePath}`}
      >
        <FileSymbol name={basename} className="mr-1 h-[1em] w-[1em] align-middle" />
        {ref}
      </button>
    );

    lastIndex = fullMatchStart + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    pushTextPart(parts, text.slice(lastIndex), replaceEmojiIcons, `${lastIndex}`);
  }

  // No matches, return plain text
  if (parts.length === 0) {
    if (replaceEmojiIcons && hasInlineMarkdownIcon(text)) {
      return <TextWithInlineMarkdownIcons text={text} />;
    }
    return <>{text}</>;
  }

  return <>{parts}</>;
}

function replaceMarkdownInlineContent(children: ReactNode): ReactNode {
  return Children.map(children, child => {
    if (typeof child === 'string' && FILE_REF_TEST_REGEX.test(child)) {
      return <TextWithFileRefs text={child} replaceEmojiIcons />;
    }

    if (typeof child === 'string' && hasInlineMarkdownIcon(child)) {
      return <TextWithInlineMarkdownIcons text={child} />;
    }

    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children) {
      if (child.type === 'code' || child.type === 'pre') return child;
      return cloneElement(child, {
        children: replaceMarkdownInlineContent(child.props.children),
      });
    }

    return child;
  });
}

/**
 * Process ReactMarkdown children: replace string children containing @path
 * with clickable file references, and known emoji with app-native inline icons.
 */
export function MarkdownChildrenWithFileRefs({ children }: { children: ReactNode }) {
  return <>{replaceMarkdownInlineContent(children)}</>;
}
