import { describe, expect, it } from 'vitest';
import {
  collectCssResourceRefs,
  collectHtmlResourceRefs,
  kindForPath,
} from '../resource-graph.js';

describe('collectHtmlResourceRefs', () => {
  it('collects stylesheets, images, srcset candidates, source src and css url() refs', () => {
    const html = `
      <link rel="stylesheet" href="assets/site.css">
      <link rel="icon" href="ignored-icon.ico">
      <img src="assets/pic.png">
      <img srcset="assets/a.png 1x, assets/b.png 2x">
      <source src="media/clip.mp4">
      <source srcset="covers/c1.avif 480w, covers/c2.avif 960w">
      <style>body { background: url("style-bg.png"); }</style>
      <div style="background-image: url('attr-bg.jpg')">x</div>
    `;
    const { refs } = collectHtmlResourceRefs(html, 'index.html');
    const paths = refs.map(ref => ref.path).sort();
    expect(paths).toEqual([
      'assets/a.png',
      'assets/b.png',
      'assets/pic.png',
      'assets/site.css',
      'attr-bg.jpg',
      'covers/c1.avif',
      'covers/c2.avif',
      'media/clip.mp4',
      'style-bg.png',
    ]);
    const kinds = new Map(refs.map(ref => [ref.path, ref.kind]));
    expect(kinds.get('assets/site.css')).toBe('css');
    expect(kinds.get('assets/pic.png')).toBe('image');
    expect(kinds.get('media/clip.mp4')).toBe('video');
    expect(kinds.get('style-bg.png')).toBe('image');
  });

  it('resolves relative refs against the referencing file directory', () => {
    const html = `<link rel="stylesheet" href="css/site.css"><img src="deep/../pic.png">`;
    const { refs } = collectHtmlResourceRefs(html, 'pages/index.html');
    expect(refs.map(ref => ref.path).sort()).toEqual(['pages/css/site.css', 'pages/pic.png']);
  });

  it('skips external, absolute and escaping references with reasons', () => {
    const html = `
      <link rel="stylesheet" href="https://cdn.example.com/x.css">
      <img src="data:image/png;base64,AAA">
      <img src="//cdn.example.com/p.png">
      <img src="/absolute.png">
      <img src="../escape.png">
      <img src="keep.png#fragment">
    `;
    const { refs, skipped } = collectHtmlResourceRefs(html, 'index.html');
    expect(refs.map(ref => ref.path)).toEqual(['keep.png']);
    const reasons = new Map(skipped.map(entry => [entry.raw, entry.reason]));
    expect(reasons.get('https://cdn.example.com/x.css')).toBe('external-url');
    expect(reasons.get('data:image/png;base64,AAA')).toBe('external-url');
    expect(reasons.get('//cdn.example.com/p.png')).toBe('external-url');
    expect(reasons.get('/absolute.png')).toBe('absolute-path');
    expect(reasons.get('../escape.png')).toBe('escapes-workspace');
  });

  it('deduplicates repeated references within one document', () => {
    const html = `<img src="a.png"><img src="a.png"><img src="./a.png">`;
    const { refs } = collectHtmlResourceRefs(html, 'index.html');
    expect(refs).toEqual([{ path: 'a.png', kind: 'image' }]);
  });

  it('collects <video src> and <source src> references as kind video (§5.3)', () => {
    const html = `
      <video src="media/clip.mp4" controls></video>
      <video controls><source src="media/clip.webm"></video>
    `;
    const { refs } = collectHtmlResourceRefs(html, 'index.html');
    const kinds = new Map(refs.map(ref => [ref.path, ref.kind]));
    expect(kinds.get('media/clip.mp4')).toBe('video');
    expect(kinds.get('media/clip.webm')).toBe('video');
  });
});

describe('kindForPath', () => {
  it('maps mp4/webm/mov (any case) to video and leaves other extensions alone', () => {
    expect(kindForPath('media/clip.mp4')).toBe('video');
    expect(kindForPath('media/clip.webm')).toBe('video');
    expect(kindForPath('media/clip.MOV')).toBe('video');
    expect(kindForPath('media/clip.mp3')).toBe('other');
    expect(kindForPath('media/clip.png')).toBe('image');
    expect(kindForPath('media/clip.woff2')).toBe('font');
    expect(kindForPath('media/clip.css')).toBe('css');
  });
});

describe('collectCssResourceRefs', () => {
  it('extracts quoted and unquoted url() including @font-face and string @import', () => {
    const css = `
      @import "extra.css";
      @import url(more/other.css);
      body { background: url("bg.png"); }
      .b { background: url( 'spacer.gif' ); }
      @font-face { font-family: X; src: url(fonts/x.woff2) format('woff2'); }
    `;
    const { refs, skipped } = collectCssResourceRefs(css, 'assets/site.css');
    const paths = refs.map(ref => ref.path).sort();
    expect(paths).toEqual([
      'assets/bg.png',
      'assets/extra.css',
      'assets/fonts/x.woff2',
      'assets/more/other.css',
      'assets/spacer.gif',
    ]);
    const kinds = new Map(refs.map(ref => [ref.path, ref.kind]));
    expect(kinds.get('assets/extra.css')).toBe('css');
    expect(kinds.get('assets/fonts/x.woff2')).toBe('font');
    expect(kinds.get('assets/bg.png')).toBe('image');
    expect(skipped).toEqual([]);
  });

  it('ignores url() inside comments and skips escapes', () => {
    const css = `
      /* body { background: url(commented.png); } */
      .up { background: url(../../outside.png); }
    `;
    const { refs, skipped } = collectCssResourceRefs(css, 'assets/site.css');
    expect(refs).toEqual([]);
    expect(skipped).toEqual([
      { raw: '../../outside.png', reason: 'escapes-workspace' },
    ]);
  });
});
