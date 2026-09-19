import { File as FileIcon, X } from 'lucide-react';
import type { Attachment } from './types';

interface AttachmentPreviewListProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}

/** Thumbnails for staged composer attachments — images preview, files iconize. */
export function AttachmentPreviewList({ attachments, onRemove }: AttachmentPreviewListProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-2 p-2 bg-muted rounded-lg">
      {attachments.map(attachment => (
        <div key={attachment.id} className="relative group bg-secondary rounded-lg overflow-hidden">
          {attachment.type === 'image' ? (
            <img
              src={attachment.data}
              alt={attachment.name}
              className="h-20 w-auto max-w-32 object-cover"
            />
          ) : (
            <div className="h-20 w-32 flex items-center justify-center p-2">
              <div className="text-center">
                <FileIcon size={32} strokeWidth={1.5} className="mx-auto text-muted-foreground" />
                <span className="text-xs text-muted-foreground truncate block mt-1">
                  {attachment.name}
                </span>
              </div>
            </div>
          )}
          <button
            onClick={() => onRemove(attachment.id)}
            className="absolute top-1 right-1 w-7 h-7 md:w-6 md:h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity before:absolute before:-inset-2 before:content-[''] md:before:content-none"
            aria-label={`Remove attachment ${attachment.name}`}
          >
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  );
}
