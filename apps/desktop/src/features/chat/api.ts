// Cross-feature surface of the chat feature for consumers that must not pull
// in the full chat barrel (index.ts re-exports SessionChatLayout, whose module
// graph reaches back into every chat component). Importing from this entry
// keeps the browser feature's ChatLink off the chat⇄browser runtime cycle.
export { useChatActionsOptional } from './ChatActionsContext';
export type { ChatActionsContextValue } from './ChatActionsContext';
