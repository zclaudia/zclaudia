import { createContext, useContext, type ReactNode } from 'react';
import type { Attachment } from './MessageInput';

export interface ChatActionsContextValue {
  handleSendMessage: (
    content: string,
    attachments?: Attachment[],
    overridePlanMode?: boolean,
  ) => Promise<void>;
  setPlanMode: (sessionId: string, planMode: boolean) => void;
}

const ChatActionsContext = createContext<ChatActionsContextValue | null>(null);

export function ChatActionsProvider({
  value,
  children,
}: {
  value: ChatActionsContextValue;
  children: ReactNode;
}) {
  return <ChatActionsContext.Provider value={value}>{children}</ChatActionsContext.Provider>;
}

/** Returns `null` when no provider is in scope (e.g. in tests that don't need it). */
export function useChatActionsOptional(): ChatActionsContextValue | null {
  return useContext(ChatActionsContext);
}
