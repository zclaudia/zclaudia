import { describe, it, expect } from 'vitest';
import { parseMessageInput } from '../message-input.js';

describe('parseMessageInput', () => {
  it('parses the {text, attachments} envelope', () => {
    const raw = JSON.stringify({ text: 'look at this', attachments: [{ fileId: 'f1', name: 'a.png', mimeType: 'image/png', type: 'image' }] });
    expect(parseMessageInput(raw)).toEqual({
      text: 'look at this',
      attachments: [{ fileId: 'f1', name: 'a.png', mimeType: 'image/png', type: 'image' }],
    });
  });

  it('treats plain text as text with no attachments', () => {
    expect(parseMessageInput('hello world')).toEqual({ text: 'hello world', attachments: [] });
  });

  it('treats user-typed JSON without a text field as plain text', () => {
    const raw = '{"foo": 1}';
    expect(parseMessageInput(raw)).toEqual({ text: raw, attachments: [] });
  });

  it('drops malformed attachment entries', () => {
    const raw = JSON.stringify({ text: 't', attachments: [{ fileId: 'f1', name: 'a.png', mimeType: 'image/png', type: 'image' }, { junk: true }, null] });
    expect(parseMessageInput(raw).attachments).toHaveLength(1);
  });

  it('treats a JSON envelope with non-string text as plain text', () => {
    const raw = '{"text": 42}';
    expect(parseMessageInput(raw)).toEqual({ text: raw, attachments: [] });
  });
});
