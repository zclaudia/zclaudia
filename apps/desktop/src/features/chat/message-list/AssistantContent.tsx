import { memo, useContext, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  logSuspiciousMarkdownRender,
  normalizeMarkdownForRender,
} from '../../../utils/messageContent';
import { useAnimationFrameThrottle } from '../../../hooks/useAnimationFrameThrottle';
import { FileRefContext, type FileRefContextValue } from './fileRefContext';
import { createAssistantMarkdownComponents } from './assistantMarkdown';

const remarkPlugins = [remarkGfm];

interface AssistantMarkdownProps extends FileRefContextValue {
  content: string;
}

// Raw streaming props can render AssistantContent before its pending frame
// commits. Keep parsing behind a memo boundary so those renders do no markdown
// work, and retain renderer identities across committed text updates.
const AssistantMarkdown = memo(function AssistantMarkdown({
  content,
  projectRoot,
  backendId,
}: AssistantMarkdownProps) {
  const normalizedContent = useMemo(() => normalizeMarkdownForRender(content), [content]);
  const components = useMemo(
    () => createAssistantMarkdownComponents({ projectRoot, backendId }),
    [projectRoot, backendId]
  );

  useEffect(() => {
    logSuspiciousMarkdownRender(content, normalizedContent);
  }, [content, normalizedContent]);

  return (
    <div className="prose dark:prose-invert prose-sm max-w-none min-w-0">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
});

/** Renders assistant message markdown (thinking blocks already extracted at MessageItem level) */
export const AssistantContent = memo(function AssistantContent({ content }: { content: string }) {
  const renderContent = useAnimationFrameThrottle(content);
  const { projectRoot, backendId } = useContext(FileRefContext);

  return (
    <AssistantMarkdown content={renderContent} projectRoot={projectRoot} backendId={backendId} />
  );
});
