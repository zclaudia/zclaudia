import { describe, it, expect } from 'vitest';
import { htmlToMarkdown, isHtmlContentType, stripHtmlToText } from '../web-extract.js';

const ARTICLE = `<!DOCTYPE html><html><head><title>Widget Guide</title></head><body>
<nav><a href="/home">Home</a> <a href="/about">About</a></nav>
<article>
  <h1>Installing Widgets</h1>
  <p>Run the <strong>installer</strong> and follow the prompts. See the <a href="/docs">docs</a>.</p>
  <h2>Steps</h2>
  <ol><li>Download</li><li>Unzip</li><li>Run</li></ol>
  <pre><code>npm install widget</code></pre>
</article>
<footer>© 2026 Widgets Inc — lots of footer noise repeated many times to look like boilerplate.</footer>
</body></html>`;

describe('isHtmlContentType', () => {
  it('recognizes html content types', () => {
    expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true);
    expect(isHtmlContentType('application/xhtml+xml')).toBe(true);
  });
  it('rejects non-html', () => {
    expect(isHtmlContentType('application/json')).toBe(false);
    expect(isHtmlContentType('text/markdown')).toBe(false);
    expect(isHtmlContentType('')).toBe(false);
  });
});

describe('htmlToMarkdown', () => {
  it('extracts the main article as markdown with structure preserved', async () => {
    const result = await htmlToMarkdown(ARTICLE, 'https://example.com/guide');
    expect(result.mode).toBe('readability');
    expect(result.title).toBe('Widget Guide');
    // headings become atx
    expect(result.markdown).toMatch(/#+\s+Installing Widgets/);
    // emphasis preserved
    expect(result.markdown).toContain('**installer**');
    // ordered list preserved
    expect(result.markdown).toMatch(/1\.\s+Download/);
    // fenced code block
    expect(result.markdown).toContain('```');
    expect(result.markdown).toContain('npm install widget');
  });

  it('resolves relative links to absolute using the base url', async () => {
    const result = await htmlToMarkdown(ARTICLE, 'https://example.com/guide');
    expect(result.markdown).toContain('https://example.com/docs');
  });

  it('drops nav/footer boilerplate via readability', async () => {
    const result = await htmlToMarkdown(ARTICLE, 'https://example.com/guide');
    expect(result.markdown).not.toContain('footer noise');
  });

  it('falls back to full-document conversion when there is no article', async () => {
    const fragment = '<div><h3>Note</h3><p>Just a <em>snippet</em>.</p></div>';
    const result = await htmlToMarkdown(fragment);
    expect(['full', 'readability']).toContain(result.mode);
    expect(result.markdown).toContain('snippet');
  });

  it('never throws on malformed html', async () => {
    const r = await htmlToMarkdown('<html><body><p>unclosed', 'https://x.com');
    expect(r.markdown).toContain('unclosed');
  });
});

describe('stripHtmlToText', () => {
  it('strips tags and decodes entities', () => {
    expect(stripHtmlToText('<p>a &amp; b</p><p>c</p>')).toBe('a & b\n\nc');
  });
});
