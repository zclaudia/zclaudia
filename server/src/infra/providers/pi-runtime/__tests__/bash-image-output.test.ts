import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { extractBashImageOutput } from '../bash-image-output.js';

// Minimal valid-signature PNG (1x1 pixel): only the magic bytes matter here —
// extraction sniffs signatures and never decodes pixel data.
const TINY_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function iterm2Sequence(payload: Buffer): string {
  return (
    `\x1b]1337;File=name=tiny.png;size=${payload.length};inline=1:` +
    payload.toString('base64') +
    '\x07'
  );
}

describe('extractBashImageOutput — data URL stdout', () => {
  it('converts a whole-output PNG data URL into an image block', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
    const extraction = await extractBashImageOutput({
      output: `data:image/png;base64,${TINY_PNG.toString('base64')}\n`,
      runCwd: dir,
      supportsVision: true,
    });
    await rm(dir, { recursive: true, force: true });
    expect(extraction.images).toHaveLength(1);
    expect(extraction.images[0].mimeType).toBe('image/png');
    expect(extraction.images[0].data.equals(TINY_PNG)).toBe(true);
    expect(extraction.images[0].source).toBe('stdout data URL');
    expect(extraction.output).toContain('attached as an image block below');
    expect(extraction.output).not.toContain('base64,');
  });

  it('keeps a payload that is not a decodable image out of the blocks', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
    const extraction = await extractBashImageOutput({
      output: `data:image/png;base64,${Buffer.from('definitely not an image').toString('base64')}`,
      runCwd: dir,
      supportsVision: true,
    });
    await rm(dir, { recursive: true, force: true });
    expect(extraction.images).toHaveLength(0);
    expect(extraction.output).toContain('undecodable');
  });

  it('does not attach blocks for a non-vision model but still replaces the blob', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
    const extraction = await extractBashImageOutput({
      output: `data:image/png;base64,${TINY_PNG.toString('base64')}`,
      runCwd: dir,
      supportsVision: false,
    });
    await rm(dir, { recursive: true, force: true });
    expect(extraction.images).toHaveLength(0);
    expect(extraction.output).toContain('no vision');
  });

  it('leaves a data URL embedded in larger text untouched', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
    const text = `see data:image/png;base64,${TINY_PNG.toString('base64')} above`;
    const extraction = await extractBashImageOutput({
      output: text,
      runCwd: dir,
      supportsVision: true,
    });
    await rm(dir, { recursive: true, force: true });
    expect(extraction.images).toHaveLength(0);
    expect(extraction.output).toBe(text);
  });
});

describe('extractBashImageOutput — iTerm2 inline images', () => {
  it('decodes an iTerm2 File sequence into an image block for vision models', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
    const output = `rendering done\n${iterm2Sequence(TINY_PNG)}\nexit 0\n`;
    const extraction = await extractBashImageOutput({
      output,
      runCwd: dir,
      supportsVision: true,
    });
    await rm(dir, { recursive: true, force: true });
    expect(extraction.images).toHaveLength(1);
    expect(extraction.images[0].data.equals(TINY_PNG)).toBe(true);
    expect(extraction.output).toContain('[iTerm2 inline image — attached below]');
    expect(extraction.output).not.toContain(TINY_PNG.toString('base64'));
    expect(extraction.output).toContain('rendering done');
  });

  it('strips the sequence without attaching for non-vision models', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
    const extraction = await extractBashImageOutput({
      output: iterm2Sequence(TINY_PNG),
      runCwd: dir,
      supportsVision: false,
    });
    await rm(dir, { recursive: true, force: true });
    expect(extraction.images).toHaveLength(0);
    expect(extraction.output).toBe('[iTerm2 inline image]');
  });

  it('reports an undecodable payload instead of emitting a block', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
    const sequence =
      '\x1b]1337;File=inline=1:' + Buffer.from('not an image').toString('base64') + '\x1b\\';
    const extraction = await extractBashImageOutput({
      output: `before ${sequence} after`,
      runCwd: dir,
      supportsVision: true,
    });
    await rm(dir, { recursive: true, force: true });
    expect(extraction.images).toHaveLength(0);
    expect(extraction.notes).toHaveLength(1);
    expect(extraction.output).toBe('before [iTerm2 inline image] after');
    expect(extraction.output).not.toContain('not an image');
  });
});

describe('extractBashImageOutput — sixel', () => {
  it('replaces a sixel stream with a placeholder and a note, without a block', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
    const sixel = '\x1bP0;1q#0;2;0;0#0~~~~-\x1b\\';
    const extraction = await extractBashImageOutput({
      output: `drawing\n${sixel}\ndone\n`,
      runCwd: dir,
      supportsVision: true,
    });
    await rm(dir, { recursive: true, force: true });
    expect(extraction.images).toHaveLength(0);
    expect(extraction.output).toContain('[sixel image]');
    expect(extraction.output).not.toContain('#0;2;0;0');
    expect(extraction.notes[0]).toContain('Sixel image data');
  });
});

describe('extractBashImageOutput — image files in output', () => {
  it('attaches an existing image file whose path the command printed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
    await writeFile(path.join(dir, 'out.png'), TINY_PNG);
    const extraction = await extractBashImageOutput({
      output: 'wrote out.png.\n',
      runCwd: dir,
      supportsVision: true,
    });
    await rm(dir, { recursive: true, force: true });
    expect(extraction.images).toHaveLength(1);
    expect(extraction.images[0].mimeType).toBe('image/png');
    expect(extraction.images[0].data.equals(TINY_PNG)).toBe(true);
    expect(extraction.images[0].source).toBe(path.join(dir, 'out.png'));
  });

  it('ignores paths that do not exist on disk', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
    const extraction = await extractBashImageOutput({
      output: 'missing missing.png untouched\n',
      runCwd: dir,
      supportsVision: true,
    });
    await rm(dir, { recursive: true, force: true });
    expect(extraction.images).toHaveLength(0);
    expect(extraction.notes).toHaveLength(0);
  });

  it('does not read image files for non-vision models', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
    await writeFile(path.join(dir, 'out.png'), TINY_PNG);
    const extraction = await extractBashImageOutput({
      output: 'wrote out.png\n',
      runCwd: dir,
      supportsVision: false,
    });
    await rm(dir, { recursive: true, force: true });
    expect(extraction.images).toHaveLength(0);
  });

  it('caps attached file images and notes the remainder', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
    for (const name of ['a.png', 'b.png', 'c.png', 'd.png']) {
      await writeFile(path.join(dir, name), TINY_PNG);
    }
    const extraction = await extractBashImageOutput({
      output: 'generated a.png b.png c.png d.png\n',
      runCwd: dir,
      supportsVision: true,
    });
    await rm(dir, { recursive: true, force: true });
    expect(extraction.images).toHaveLength(3);
    expect(extraction.notes.some(note => note.includes('not attached (max 3)'))).toBe(true);
  });

  it('deduplicates the same file mentioned twice', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
    await writeFile(path.join(dir, 'out.png'), TINY_PNG);
    const extraction = await extractBashImageOutput({
      output: 'out.png again out.png\n',
      runCwd: dir,
      supportsVision: true,
    });
    await rm(dir, { recursive: true, force: true });
    expect(extraction.images).toHaveLength(1);
  });
});
