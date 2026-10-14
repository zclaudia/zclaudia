import { memo, useContext, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  logSuspiciousMarkdownRender,
  normalizeMarkdownForRender,
} from '../../../utils/messageContent';
import { useAnimationFrameThrottle } from '../../../hooks/useAnimationFrameThrottle';
import { FileRefContext } from './fileRefContext';
import { createAssistantMarkdownComponents } from './assistantMarkdown';

/** Renders assistant message markdown (thinking blocks already extracted at MessageItem level) */
export const AssistantContent = memo(function AssistantContent({ content }: { content: string }) {
  // Throttle the string that drives the (expensive) markdown parse; the raw
  // prop still updates every frame so streaming stays smooth.
  const renderContent = useAnimationFrameThrottle(content);
  const normalizedContent = useMemo(
    () => normalizeMarkdownForRender(renderContent),
    [renderContent]
  );
  const fileRef = useContext(FileRefContext);

  useEffect(() => {
    logSuspiciousMarkdownRender(renderContent, normalizedContent);
  }, [renderContent, normalizedContent]);

  return (
    <>
      <div className="prose dark:prose-invert prose-sm max-w-none min-w-0">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={createAssistantMarkdownComponents(fileRef)}
        >
          {normalizedContent}
        </ReactMarkdown>
      </div>
    </>
  );
});
