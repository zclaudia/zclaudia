// File Browser Types (@ mention support)

export type FileEntryType = 'file' | 'directory';

export interface FileEntry {
  name: string;           // e.g., "MessageInput.tsx"
  path: string;           // relative path from project root, e.g., "src/components/chat/MessageInput.tsx"
  type: FileEntryType;
  extension?: string;     // e.g., ".tsx", ".ts", ".md" (only for files)
  size?: number;          // file size in bytes (only for files)
}

export interface DirectoryListingResponse {
  entries: FileEntry[];
  currentPath: string;    // the resolved relative path
  hasMore: boolean;       // whether there are more results
}

export interface FileContentResponse {
  path: string;           // relative path from project root
  content: string;        // file content
  size: number;           // file size in bytes
}

// Directory browser types (project root picker)

export interface DirectoryBrowseEntry {
  name: string;           // directory name, e.g. "my-project"
  path: string;           // absolute path of the directory on the backend host
}

export interface DirectoryBrowseResponse {
  path: string;                      // resolved absolute path of the current directory
  parent: string | null;            // absolute parent path, or null at the filesystem root
  directories: DirectoryBrowseEntry[]; // immediate subdirectories (sorted, dirs only)
}
