import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_ATTACHMENT_BYTES,
  MAX_MESSAGE_ATTACHMENTS,
  validateMessageAttachmentFiles,
} from './attachment-validation.js';

describe('message attachment validation', () => {
  it('rejects files larger than the inline attachment limit', () => {
    const result = validateMessageAttachmentFiles([
      {
        name: 'large.pdf',
        size: MAX_MESSAGE_ATTACHMENT_BYTES + 1,
        type: 'application/pdf',
      },
    ]);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      {
        code: 'file_too_large',
        fileName: 'large.pdf',
        message: '"large.pdf" is too large. Attachments must be 10 MB or smaller.',
      },
    ]);
  });

  it('rejects unsupported attachment types', () => {
    const result = validateMessageAttachmentFiles([
      { name: 'archive.zip', size: 1024, type: 'application/zip' },
    ]);

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]).toMatchObject({
      code: 'unsupported_type',
      fileName: 'archive.zip',
    });
  });

  it('enforces the attachment count limit against existing attachments', () => {
    const files = [
      { name: 'one.txt', size: 10, type: 'text/plain' },
      { name: 'two.txt', size: 10, type: 'text/plain' },
    ];

    const result = validateMessageAttachmentFiles(files, {
      existingCount: MAX_MESSAGE_ATTACHMENTS - 1,
    });

    expect(result.accepted).toEqual([files[0]]);
    expect(result.rejected).toEqual([
      {
        code: 'too_many',
        fileName: 'two.txt',
        message: 'You can attach up to 8 files.',
      },
    ]);
  });
});
