import { useState, type ChangeEvent, type RefObject } from 'react';
import { validateMessageAttachmentFiles } from '@zclaudia/shared';
import { downscaleImageFile } from '../../attachments/downscale-image';
import type { Attachment } from '../types';

interface UseAttachmentPickerOptions {
  /** Hidden `<input type="file">` ref — its value is reset after each pick. */
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** Draft-mirror ref; kept in sync so the persisted draft matches the list. */
  pendingAttachmentsRef: RefObject<Attachment[]>;
  /** Schedules a debounced draft persist after the staged list changes. */
  scheduleDraftPersistence: () => void;
}

/**
 * Attachment staging for the composer: picker input handling, ingestion of
 * picked/pasted files (count+size validation via the shared attachment rules,
 * image downscaling), the staged list itself, and per-item removal.
 */
export function useAttachmentPicker({
  fileInputRef,
  pendingAttachmentsRef,
  scheduleDraftPersistence,
}: UseAttachmentPickerOptions) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const readFileAsAttachment = async (file: File): Promise<void> => {
    if (file.type.startsWith('image/')) {
      file = await downscaleImageFile(file);
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const attachment: Attachment = {
          id: crypto.randomUUID(),
          type: file.type.startsWith('image/') ? 'image' : 'file',
          name: file.name,
          data: reader.result as string,
          mimeType: file.type,
        };
        setAttachments(prev => {
          const nextAttachments = [...prev, attachment];
          pendingAttachmentsRef.current = nextAttachments;
          scheduleDraftPersistence();
          return nextAttachments;
        });
        resolve();
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });
  };

  const addFilesAsAttachments = async (files: File[]): Promise<void> => {
    const validation = validateMessageAttachmentFiles(files, {
      existingCount: pendingAttachmentsRef.current.length,
    });

    if (validation.rejected.length > 0) {
      setAttachmentError(validation.rejected.map(issue => issue.message).join(' '));
    } else {
      setAttachmentError(null);
    }

    for (const file of validation.accepted) {
      try {
        await readFileAsAttachment(file);
        setAttachmentError(null);
      } catch {
        setAttachmentError(`Failed to read "${file.name}".`);
      }
    }
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    await addFilesAsAttachments(Array.from(files));

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => {
      const nextAttachments = prev.filter(a => a.id !== id);
      pendingAttachmentsRef.current = nextAttachments;
      scheduleDraftPersistence();
      return nextAttachments;
    });
  };

  /** Clears the staged list, any error, and the draft mirror (after a send). */
  const clearAttachments = () => {
    setAttachments([]);
    setAttachmentError(null);
    pendingAttachmentsRef.current = [];
  };

  return {
    attachments,
    setAttachments,
    attachmentError,
    addFilesAsAttachments,
    handleFileSelect,
    removeAttachment,
    clearAttachments,
  };
}
