import type {
  DirectoryBrowseResponse,
  DirectoryListingResponse,
  FileContentResponse,
  FileStatResponse,
} from '@zclaudia/shared';
import { apiCall, apiCallForBackend } from './unwrap';

export async function browseDirectories(params: {
  path?: string;
  backendId?: string | null;
}): Promise<DirectoryBrowseResponse> {
  const queryParams = new URLSearchParams({
    ...(params.path && { path: params.path }),
  });
  const suffix = queryParams.toString() ? `?${queryParams}` : '';

  return params.backendId
    ? apiCallForBackend<DirectoryBrowseResponse>(
        params.backendId,
        `/api/files/browse-dirs${suffix}`
      )
    : apiCall<DirectoryBrowseResponse>(`/api/files/browse-dirs${suffix}`);
}

export async function listDirectory(params: {
  projectRoot: string;
  relativePath?: string;
  query?: string;
  maxResults?: number;
  backendId?: string | null;
}): Promise<DirectoryListingResponse> {
  const queryParams = new URLSearchParams({
    projectRoot: params.projectRoot,
    ...(params.relativePath && { relativePath: params.relativePath }),
    ...(params.query && { query: params.query }),
    ...(params.maxResults !== undefined && { maxResults: String(params.maxResults) }),
  });

  return params.backendId
    ? apiCallForBackend<DirectoryListingResponse>(
        params.backendId,
        `/api/files/list?${queryParams}`
      )
    : apiCall<DirectoryListingResponse>(`/api/files/list?${queryParams}`);
}

export async function getFileContent(params: {
  projectRoot: string;
  relativePath: string;
  backendId?: string | null;
}): Promise<FileContentResponse> {
  const queryParams = new URLSearchParams({
    projectRoot: params.projectRoot,
    relativePath: params.relativePath,
  });

  return params.backendId
    ? apiCallForBackend<FileContentResponse>(params.backendId, `/api/files/content?${queryParams}`)
    : apiCall<FileContentResponse>(`/api/files/content?${queryParams}`);
}

/**
 * Lightweight metadata (mtime + size) for a file — used to poll for external
 * file changes without re-reading full content. Returns the file's
 * last-modified time in ms since epoch.
 */
export async function getFileStat(params: {
  projectRoot: string;
  relativePath: string;
  backendId?: string | null;
}): Promise<FileStatResponse> {
  const queryParams = new URLSearchParams({
    projectRoot: params.projectRoot,
    relativePath: params.relativePath,
  });

  return params.backendId
    ? apiCallForBackend<FileStatResponse>(params.backendId, `/api/files/stat?${queryParams}`)
    : apiCall<FileStatResponse>(`/api/files/stat?${queryParams}`);
}
