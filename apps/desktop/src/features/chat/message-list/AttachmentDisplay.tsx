import { useState, useCallback } from 'react';
import { Image } from 'lucide-react';
import type { MessageAttachment } from '@zclaudia/shared/core/message';
import { downloadFile } from '../../../services/fileUpload';

// Attachment display component — lazy load: only download on click
export function AttachmentDisplay({ attachment }: { attachment: MessageAttachment }) {
  const [imageData, setImageData] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadImage = useCallback(() => {
    if (loading || imageData) return;
    setLoading(true);
    setError(null);
    downloadFile(attachment.fileId)
      .then(result => {
        setImageData(`data:${result.mimeType};base64,${result.data}`);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load image:', err);
        setError('Failed to load image');
        setLoading(false);
      });
  }, [attachment.fileId, loading, imageData]);

  if (attachment.type === 'image') {
    if (imageData) {
      return (
        <div className="rounded-lg overflow-hidden bg-black/20 inline-block max-w-full">
          <img
            src={imageData}
            alt={attachment.name}
            className="block max-w-full h-auto"
            style={{ maxHeight: '300px' }}
          />
          <div className="px-2 py-1 bg-black/20 text-xs text-foreground/70">{attachment.name}</div>
        </div>
      );
    }

    if (loading) {
      return (
        <div className="border border-border rounded-lg p-4 bg-secondary/50 text-center text-sm text-muted-foreground">
          Loading image...
        </div>
      );
    }

    // Default: show clickable placeholder
    return (
      <div
        className="border border-border rounded-lg overflow-hidden bg-secondary/30 cursor-pointer hover:bg-secondary/50 transition-colors"
        onClick={loadImage}
      >
        <div className="flex items-center justify-center h-24 text-muted-foreground">
          <div className="text-center">
            <Image size={32} strokeWidth={1.75} className="mx-auto mb-1 opacity-50" />
            <div className="text-xs">
              {error ? 'Load failed — click to retry' : 'Click to load image'}
            </div>
          </div>
        </div>
        <div className="px-2 py-1 bg-secondary text-xs text-muted-foreground border-t border-border">
          {attachment.name}
        </div>
      </div>
    );
  }

  // Fallback for other file types
  return (
    <div className="px-2 py-1 bg-secondary text-xs rounded-md inline-block">{attachment.name}</div>
  );
}
