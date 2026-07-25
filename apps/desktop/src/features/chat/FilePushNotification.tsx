import { useState } from 'react';
import { Archive, Check, File, Folder, Image, Smartphone, X } from 'lucide-react';
import { useFilePushStore, type FilePushItem } from '../../stores/filePushStore';
import {
  downloadPushedFile,
  formatFileSize,
  openFile,
  openFileAndroid,
  openFolder,
  isAndroid,
} from '../../services/fileDownload';
import { isPreviewable, FilePreviewModal } from './FilePreviewModal';

/** Icon based on MIME type */
function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('image/')) {
    return <Image className="w-5 h-5" strokeWidth={1.75} />;
  }
  if (mimeType === 'application/vnd.android.package-archive') {
    // Android APK icon
    return <Smartphone className="w-5 h-5" strokeWidth={1.75} />;
  }
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('gzip')) {
    return <Archive className="w-5 h-5" strokeWidth={1.75} />;
  }
  // Default file icon
  return <File className="w-5 h-5" strokeWidth={1.75} />;
}

/** Open file: preview in-app for supported types, external app otherwise */
function handleOpenFile(item: FilePushItem, setPreview: (item: FilePushItem) => void) {
  if (isPreviewable(item.mimeType, item.fileName)) {
    setPreview(item);
    return;
  }
  // Not previewable → open with external app
  const path = item.privatePath || item.savedPath;
  if (!path) return;
  if (isAndroid()) {
    openFileAndroid(path, item.mimeType);
  } else {
    openFile(path);
  }
}

export function FilePushCard({
  item,
  onPreview,
}: {
  item: FilePushItem;
  onPreview: (item: FilePushItem) => void;
}) {
  const handleDownload = () => {
    if (item.status === 'downloading') return;
    downloadPushedFile(item.fileId);
  };

  const handleDismiss = () => {
    useFilePushStore.getState().removeItem(item.fileId);
  };

  const isAutoCompleted = item.autoDownload && item.status === 'completed';
  const hasOpenablePath = !!(item.privatePath || item.savedPath);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* File icon */}
        <div className="flex-shrink-0 text-muted-foreground">
          <FileIcon mimeType={item.mimeType} />
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{item.fileName}</div>
          <div className="text-xs text-muted-foreground">
            {formatFileSize(item.fileSize)}
            {item.description && <> &middot; {item.description}</>}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {item.status === 'pending' && (
            <button
              onClick={handleDownload}
              className="px-3 py-1 text-xs font-medium text-foreground bg-muted/60 hover:bg-muted rounded-md transition-colors"
            >
              Download
            </button>
          )}

          {item.status === 'downloading' && (
            <span className="text-xs text-muted-foreground">{item.downloadProgress}%</span>
          )}

          {item.status === 'completed' && (
            <div className="flex items-center gap-1.5">
              {hasOpenablePath ? (
                <>
                  {/* Open file: in-app preview or external app */}
                  <button
                    onClick={() => handleOpenFile(item, onPreview)}
                    className="px-2 py-0.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    title="Open file"
                  >
                    Open
                  </button>
                  {/* Show in Finder/Explorer (desktop only) */}
                  {!isAndroid() && (
                    <button
                      onClick={() => openFolder(item.savedPath!)}
                      className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                      title="Show in folder"
                    >
                      <Folder className="w-4 h-4" strokeWidth={1.75} />
                    </button>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <Check className="w-4 h-4" strokeWidth={1.75} />
                  {isAutoCompleted ? 'Saved' : 'Downloaded'}
                </div>
              )}
            </div>
          )}

          {item.status === 'error' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-destructive">{item.error || 'Failed'}</span>
              <button
                onClick={handleDownload}
                className="px-2 py-0.5 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Dismiss button */}
          {(item.status === 'completed' || item.status === 'error') && (
            <button
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar (shown during download) */}
      {item.status === 'downloading' && (
        <div className="h-1 bg-secondary">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${item.downloadProgress}%` }}
          />
        </div>
      )}
    </div>
  );
}

interface FilePushNotificationListProps {
  sessionId: string;
}

export function FilePushNotificationList({ sessionId }: FilePushNotificationListProps) {
  const items = useFilePushStore(state => state.items.filter(i => i.sessionId === sessionId));
  const [previewItem, setPreviewItem] = useState<FilePushItem | null>(null);

  if (items.length === 0) return null;

  return (
    <>
      <div className="mt-4 space-y-2 max-w-full md:max-w-3xl lg:max-w-4xl xl:max-w-5xl">
        {items.map(item => (
          <FilePushCard key={item.fileId} item={item} onPreview={setPreviewItem} />
        ))}
      </div>

      {previewItem && <FilePreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />}
    </>
  );
}
