export interface DraftAttachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  data: string;
  mimeType: string;
}

export interface SessionDraft {
  content: string;
  attachments: DraftAttachment[];
}
