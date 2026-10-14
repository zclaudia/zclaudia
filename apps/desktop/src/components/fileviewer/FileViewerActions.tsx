import { useState } from 'react';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { useWorkspaceTool } from '../workspace/WorkspaceToolContext';
import {
  Check,
  Code,
  Copy,
  ExternalLink,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  TextSearch,
} from 'lucide-react';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { isDesktopTauri } from '../../utils/platform';
import {
  openPopoutWindow,
  buildWindowTitle,
  getConnectionParams,
} from '../../actions/popoutWindow';
import { useProjectStore } from '../../stores/projectStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { detectLanguage } from './detectLanguage';

export function resolveProjectBackendId(projectRoot: string): string | null {
  const projects = useProjectStore.getState().projects;
  const matchingProject = projects.find(project => project.rootPath === projectRoot);
  if (!matchingProject) return null;
  return useOwnershipStore.getState().getProjectBackendId(matchingProject.id);
}

async function openFileInNewWindow(filePath: string, projectRoot: string, scopedBackendId?: string) {
  const fileName = filePath.split('/').pop() || filePath;
  const projectName = projectRoot.split('/').pop() || projectRoot;
  const backendId = scopedBackendId ?? resolveProjectBackendId(projectRoot);
  const conn = getConnectionParams({ backendId });
  await openPopoutWindow({
    type: 'file-viewer',
    params: { fileViewer: filePath, projectRoot },
    title: buildWindowTitle(fileName, conn.serverName, projectName),
    width: 800,
    height: 600,
    dragDropEnabled: true,
    connectionTarget: { backendId },
  });
}

/** File viewer toolbar actions (search, copy, open in new window / fullscreen) rendered in the shared BottomPanel header */
export function FileViewerActions() {
  const tool = useWorkspaceTool();
  const isMobile = useIsMobile();
  const {
    searchOpen,
    setSearchOpen,
    inFileSearchOpen,
    setInFileSearchOpen,
    content,
    filePath,
    projectRoot,
    backendId,
    setFullscreen,
    showTree,
    toggleTree,
    markdownSourceView,
    toggleMarkdownSourceView,
    compactLayout,
  } = useFileViewerStore();
  // Narrow panels lay out like mobile: the tree is reached with Back, not a toggle.
  const compact = isMobile || compactLayout;
  const showFileTree = compact ? !filePath : showTree;
  const isMarkdown = !!filePath && detectLanguage(filePath) === 'markdown';
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExpand = () => {
    if (!filePath) return;
    if (isDesktopTauri() && projectRoot) {
      openFileInNewWindow(filePath, projectRoot, tool?.backendId ?? backendId ?? undefined);
    } else {
      setFullscreen(true);
    }
  };

  if (tool && ((tool.projectRoot && projectRoot && tool.projectRoot !== projectRoot) ||
    (tool.backendId && backendId && tool.backendId !== backendId))) return null;

  return (
    <div className="flex items-center gap-1">
      {filePath && !compact && (
        <button
          type="button"
          onClick={toggleTree}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors flex-shrink-0 ${
            showFileTree
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          }`}
          title={showFileTree ? 'Hide file tree' : 'Show file tree'}
          aria-label={showFileTree ? 'Hide file tree' : 'Show file tree'}
        >
          {showFileTree ? (
            <PanelLeftClose className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <PanelLeftOpen className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </button>
      )}
      <button
        onClick={() => setSearchOpen(!searchOpen)}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors flex-shrink-0 ${
          searchOpen
            ? 'bg-secondary text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        } hover:bg-secondary`}
        title="Search files (Cmd+P)"
        aria-label="Search files"
      >
        <Search className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {content && isMarkdown && (
        <button
          onClick={toggleMarkdownSourceView}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors flex-shrink-0 ${
            markdownSourceView
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          } hover:bg-secondary`}
          title={markdownSourceView ? 'Show rendered preview' : 'Show markdown source'}
          aria-label={markdownSourceView ? 'Show rendered preview' : 'Show markdown source'}
          aria-pressed={markdownSourceView}
        >
          <Code className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
      {content && (
        <button
          onClick={() => setInFileSearchOpen(!inFileSearchOpen)}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors flex-shrink-0 ${
            inFileSearchOpen
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          } hover:bg-secondary`}
          title="Find in file (Cmd+F)"
          aria-label="Find in file"
        >
          <TextSearch className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
      {content && (
        <button
          onClick={handleCopy}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors flex-shrink-0 ${
            copied
              ? 'text-green-500'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          }`}
          title={copied ? 'Copied!' : 'Copy file content'}
          aria-label={copied ? 'Copied file content' : 'Copy file content'}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </button>
      )}
      {filePath && !isMobile && (
        <button
          onClick={handleExpand}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground flex-shrink-0"
          title={isDesktopTauri() ? 'Open in new window' : 'Fullscreen'}
          aria-label={isDesktopTauri() ? 'Open in new window' : 'Fullscreen'}
        >
          {isDesktopTauri() ? (
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  );
}
