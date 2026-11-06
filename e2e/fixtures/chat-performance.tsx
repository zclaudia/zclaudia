import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatMessagePane } from '../../apps/desktop/src/features/chat/ChatMessagePane';
import { useMessagePagination } from '../../apps/desktop/src/features/chat/hooks/useMessagePagination';
import {
  useChatMessageStore,
  type MessageWithToolCalls,
} from '../../apps/desktop/src/stores/chatMessageStore';

declare global {
  interface Window {
    chatPerformance: {
      ready: boolean;
      messageCount: number;
      fetchCalls: { limit: number; before?: number }[];
      initialMessages: MessageWithToolCalls[];
      olderMessages: MessageWithToolCalls[];
      holdOlder: boolean;
      releaseOlder: (() => void) | null;
      append: () => number;
      older: () => Promise<void>;
      jump: () => void;
      stableParagraph?: Element | null;
    };
  }
}

const empty: never[] = [];
let appendCount = 0;

function message(index: number): MessageWithToolCalls {
  return {
    id: `m${index}`,
    sessionId: 's',
    role: index === 49 ? 'assistant' : 'user',
    createdAt: index + 1,
    content:
      index === 49
        ? 'Stable paragraph.\n\n```ts\nconst answer = 42;\n```\n\nTail'
        : `Message ${index} ${'中文长消息测试 '.repeat(40)}\n`.repeat(2 + (Math.abs(index) % 5)),
  };
}

window.chatPerformance = {
  ready: false,
  messageCount: 0,
  fetchCalls: [],
  initialMessages: Array.from({ length: 50 }, (_, index) => message(index)),
  olderMessages: Array.from({ length: 20 }, (_, index) => message(index - 20)),
  holdOlder: false,
  releaseOlder: null,
  append: () => 0,
  older: async () => {},
  jump: () => {},
};

function Fixture() {
  const pagination = useMessagePagination({
    sessionId: 's',
    isConnected: true,
    isMobile: window.innerWidth < 768,
  });
  const messages = useChatMessageStore(state => state.messages.s || empty);

  useEffect(() => {
    Object.assign(window.chatPerformance, {
      ready: true,
      messageCount: messages.length,
      append: () => {
        const sequence = ++appendCount;
        useChatMessageStore
          .getState()
          .appendToMessage(
            's',
            'm49',
            `\n\nStream chunk ${sequence}\n\n` + '追加的流式文字 '.repeat(40)
          );
        return sequence;
      },
      older: pagination.loadMoreMessages,
      jump: pagination.jumpToBottomInstant,
    });
  });

  return (
    <ChatMessagePane
      {...pagination}
      sessionId="s"
      sessionMessages={messages}
      lastSessionMessage={messages.at(-1) || null}
      lastStreamingBlock={null}
      streamingContentSignature=""
      useStreamingSegmented={false}
      sessionContentBlocks={empty}
      sessionToolCallHistory={empty}
      sessionToolCalls={empty}
      sessionHealth={null}
      isLoading={false}
      resendTargetMessageId={undefined}
      resendDisabled={false}
      onResendTarget={() => {}}
      onCancelRun={() => {}}
      permissionRequests={empty}
      onPermissionDecision={async () => {}}
    />
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing chat performance fixture root');
createRoot(root).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>
);
