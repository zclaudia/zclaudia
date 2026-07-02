/**
 * HTML → Markdown extraction for WebFetch.
 *
 * Readability strips nav/ads/boilerplate to the main article, then turndown
 * converts the cleaned HTML to Markdown — far more useful to the model than
 * the old regex text strip. All pure-JS (linkedom/readability/turndown), no
 * native build burden, consistent with the unpdf/jimp choices. Falls back to
 * whole-document conversion, then plain text, if extraction fails.
 */

interface ExtractedDoc {
  markdown: string;
  title?: string;
  byline?: string;
  excerpt?: string;
  /** 'readability' = main-article extraction; 'full' = whole document; 'text' = plain-text fallback. */
  mode: 'readability' | 'full' | 'text';
}

async function buildTurndown(): Promise<InstanceType<typeof import('turndown')>> {
  const { default: TurndownService } = await import('turndown');
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    hr: '---',
  });
  // Drop non-content elements outright.
  service.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'form']);
  return service;
}

/** Last-resort: strip tags to readable text (mirrors the legacy behavior). */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?(p|div|br|h[1-6]|li|tr|article|section)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Convert an HTML document to Markdown. `url` is used as the Readability base
 * so relative links resolve to absolute URLs.
 */
export async function htmlToMarkdown(html: string, url?: string): Promise<ExtractedDoc> {
  // 1. Readability main-article extraction.
  try {
    const { parseHTML } = await import('linkedom');
    const { Readability } = await import('@mozilla/readability');
    const { document } = parseHTML(html);
    if (url) {
      const base = document.createElement('base');
      base.setAttribute('href', url);
      document.head?.appendChild(base);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const article = new Readability(document as any).parse();
    if (article?.content) {
      const turndown = await buildTurndown();
      const markdown = turndown.turndown(article.content).trim();
      if (markdown) {
        return {
          markdown,
          title: article.title ?? undefined,
          byline: article.byline ?? undefined,
          excerpt: article.excerpt ?? undefined,
          mode: 'readability',
        };
      }
    }
  } catch {
    // fall through to whole-document conversion
  }

  // 2. Whole-document turndown (no boilerplate stripping).
  try {
    const turndown = await buildTurndown();
    const markdown = turndown.turndown(html).trim();
    if (markdown) return { markdown, mode: 'full' };
  } catch {
    // fall through to text
  }

  // 3. Plain-text strip.
  return { markdown: stripHtmlToText(html), mode: 'text' };
}

/** Content types that are already model-friendly text and must not be HTML-converted. */
export function isHtmlContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (!ct) return false;
  return ct.includes('text/html') || ct.includes('application/xhtml');
}

/** Sniff a body for HTML markers — used when the response has no content-type. */
export function looksLikeHtml(body: string): boolean {
  return /<(!doctype html|html|head|body|div|p|h[1-6]|article|main|table)\b/i.test(
    body.slice(0, 4096)
  );
}

/**
 * Decide whether to run HTML→markdown extraction: explicit HTML content type,
 * or no content type with an HTML-looking body. An explicit non-HTML type
 * (json, plain, etc.) is passed through verbatim.
 */
export function shouldExtractAsHtml(contentType: string, body: string): boolean {
  if (isHtmlContentType(contentType)) return true;
  if (!contentType) return looksLikeHtml(body);
  return false;
}
