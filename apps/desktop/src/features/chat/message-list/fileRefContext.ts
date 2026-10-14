import { createContext } from 'react';

export interface FileRefContextValue {
  projectRoot?: string;
  backendId?: string | null;
}

/**
 * Message-list-local context: carries the project root + backend used to
 * resolve `filename.ext:line` references inside rendered message content.
 * Provided by the MessageList container, consumed by the markdown renderers.
 */
export const FileRefContext = createContext<FileRefContextValue>({});
