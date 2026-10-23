import { describe, expect, it } from 'vitest';
import {
  addDeckSlide,
  DECK_RATIO_DIMENSIONS,
  deleteDeckSlide,
  filterSlideInPreviewHtml,
  isDeck,
  parseDeck,
  reorderDeckSlides,
  setDeckRatio,
  updateDeckSlideNotes,
  updateDeckSlideTitle,
  type DeckRatio,
} from '../deck';
import { buildElementTree, type ElementTreeNode } from '../element-tree';
import { DesignEditError, type DesignEditErrorCode } from '../types';

function expectDeckError(fn: () => unknown, code: DesignEditErrorCode): void {
  let error: unknown;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(DesignEditError);
  expect((error as DesignEditError).code).toBe(code);
}

/** 移除给定源码范围后剩余的字节（用于块外字节不变的断言）。 */
function stripSpans(source: string, spans: { start: number; end: number }[]): string {
  let result = source;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, span.start) + result.slice(span.end);
  }
  return result;
}

function findNode(nodes: ElementTreeNode[], path: number[]): ElementTreeNode | null {
  for (const node of nodes) {
    if (node.path.join(',') === path.join(',')) return node;
    const found = findNode(node.children, path);
    if (found) return found;
  }
  return null;
}

const NESTED_DECK = `<!doctype html>
<html>
<head><title>deck</title></head>
<body>
  <!-- 首注释 -->
  <section data-zclaudia-slide data-title="第一页" data-notes="备注 A">
    <h2>标题一</h2>
    <section class="inner">嵌套普通 section，不是页</section>
  </section>
  <p>夹在中间的普通节点</p>
  <!-- 中间注释 -->
  <div class="wrapper">
    <section data-zclaudia-slide><h2>标题二</h2></section>
  </div>
  <section data-zclaudia-slide data-title="第三页">第三页</section>
</body>
</html>`;

/** 全部标记元素同为 body 直接子级（可排序），块间夹非 slide 兄弟节点与注释。 */
const SIBLING_DECK = `<body>
  <!-- 头注释 -->
  <section data-zclaudia-slide data-title="第一页" data-notes="备注 A">
    <h2>标题一</h2>
    <section class="inner">嵌套普通 section</section>
  </section>
  <p>夹在中间的普通节点</p>
  <!-- 中间注释 -->
  <section data-zclaudia-slide data-title="第二页">标题二</section>
  <section data-zclaudia-slide data-title="第三页">第三页</section>
</body>`;

describe('DECK_RATIO_DIMENSIONS', () => {
  it('exposes the 96dpi logical pixel dimensions per ratio', () => {
    expect(DECK_RATIO_DIMENSIONS['16:9']).toEqual({ width: 1600, height: 900 });
    expect(DECK_RATIO_DIMENSIONS['4:3']).toEqual({ width: 1200, height: 900 });
  });
});

describe('parseDeck', () => {
  it('pairs marked slides correctly with nested plain sections', () => {
    const info = parseDeck(NESTED_DECK);
    expect(info.slides).toHaveLength(3);
    expect(info.slides.map(slide => slide.title)).toEqual(['第一页', '第 2 页', '第三页']);
    expect(info.slides.map(slide => slide.tagName)).toEqual(['section', 'section', 'section']);
    expect(info.slides[0]?.notes).toBe('备注 A');
    expect(info.slides[1]?.notes).toBe('');
    expect(info.ratio).toBe('16:9');
    // 嵌套在第一页里的普通 section 未被当作一页。
    expect(info.slides[0]?.span.end).toBeLessThan(info.slides[1]?.span.start ?? 0);
  });

  it('reports spans that slice back to the exact element source', () => {
    const info = parseDeck(NESTED_DECK);
    for (const slide of info.slides) {
      const text = NESTED_DECK.slice(slide.span.start, slide.span.end);
      expect(text).toMatch(/^<section data-zclaudia-slide/);
      expect(text.endsWith('</section>')).toBe(true);
    }
    expect(NESTED_DECK.slice(info.slides[0]!.span.start, info.slides[0]!.span.end)).toContain(
      '<section class="inner">'
    );
  });

  it('computes elementPath from body children and matches hand-calculated paths', () => {
    const info = parseDeck(NESTED_DECK);
    // 手算：body 的元素子级为 [第一页 section, p, div, 第三页 section]（注释与
    // 文本不计入序号）。slide 0 = 子级[0]；slide 1 = 子级[2](div) 的子级[0]；
    // slide 2 = 子级[3]。
    expect(info.slides.map(slide => slide.elementPath)).toEqual([[0], [2, 0], [3]]);
    const tree = buildElementTree(NESTED_DECK);
    expect(findNode(tree, [2, 0])?.tagName).toBe('section');
    expect(findNode(tree, [2, 0])?.path).toEqual(info.slides[1]!.elementPath);
  });

  it('reads the body ratio and falls back to 16:9 when missing or unknown', () => {
    expect(parseDeck('<body data-zclaudia-deck-ratio="4:3"><section data-zclaudia-slide></section></body>').ratio).toBe('4:3');
    expect(parseDeck('<body data-zclaudia-deck-ratio="3:2"><section data-zclaudia-slide></section></body>').ratio).toBe('16:9');
  });

  it('flags siblings only when every slide shares the same parent', () => {
    expect(parseDeck(NESTED_DECK).siblings).toBe(false);
    expect(
      parseDeck('<body><section data-zclaudia-slide>A</section><section data-zclaudia-slide>B</section></body>')
        .siblings
    ).toBe(true);
    expect(parseDeck('<body></body>').siblings).toBe(true);
  });

  it('throws STRUCTURE_NOT_ALLOWED past the 60-page cap', () => {
    const slide = '<section data-zclaudia-slide>x</section>';
    const source = `<body>${slide.repeat(61)}</body>`;
    expectDeckError(() => parseDeck(source), 'STRUCTURE_NOT_ALLOWED');
    expect(parseDeck(`<body>${slide.repeat(60)}</body>`).slides).toHaveLength(60);
  });

  it('throws MALFORMED_HTML when the body is missing or implicit', () => {
    expectDeckError(() => parseDeck(''), 'MALFORMED_HTML');
    expectDeckError(() => parseDeck('<div>no body</div>'), 'MALFORMED_HTML');
  });
});

describe('isDeck', () => {
  it('is true only when parseDeck succeeds with at least one slide', () => {
    expect(isDeck(NESTED_DECK)).toBe(true);
    expect(isDeck('<html><body><p>plain</p></body></html>')).toBe(false);
    expect(isDeck('')).toBe(false);
    expect(isDeck('<div>no body</div>')).toBe(false);
    expect(isDeck(`<body>${'<section data-zclaudia-slide></section>'.repeat(61)}</body>`)).toBe(false);
  });
});

describe('reorderDeckSlides', () => {
  it('moves a slide forward keeping out-of-block bytes byte-for-byte', () => {
    const next = reorderDeckSlides(SIBLING_DECK, 0, 2);
    const before = parseDeck(SIBLING_DECK);
    const after = parseDeck(next);
    expect(after.slides.map(slide => slide.title)).toEqual(['第二页', '第三页', '第一页']);
    expect(after.slides).toHaveLength(3);
    // 两块之外的全部字节（含夹在中间的 p、注释）逐字节不变。
    expect(stripSpans(SIBLING_DECK, before.slides.map(slide => slide.span))).toBe(
      stripSpans(next, after.slides.map(slide => slide.span))
    );
    // 被搬移的块自身字节原样保留，无粘连。
    const first = SIBLING_DECK.slice(before.slides[0]!.span.start, before.slides[0]!.span.end);
    expect(next).toContain(first);
    expect(next).toContain('<p>夹在中间的普通节点</p>');
    expect(next).toContain('<!-- 中间注释 -->');
  });

  it('moves a slide backward keeping out-of-block bytes byte-for-byte', () => {
    const next = reorderDeckSlides(SIBLING_DECK, 2, 0);
    const before = parseDeck(SIBLING_DECK);
    const after = parseDeck(next);
    // 第三页插到第一页原位置；中间页与 p/注释整体后移，文档序变为 C、B、A。
    expect(after.slides.map(slide => slide.title)).toEqual(['第三页', '第二页', '第一页']);
    expect(stripSpans(SIBLING_DECK, before.slides.map(slide => slide.span))).toBe(
      stripSpans(next, after.slides.map(slide => slide.span))
    );
  });

  it('swaps adjacent slides with no filler between them', () => {
    const source = '<body><section data-zclaudia-slide data-title="A">A</section><section data-zclaudia-slide data-title="B">B</section></body>';
    const next = reorderDeckSlides(source, 0, 1);
    expect(next).toBe('<body><section data-zclaudia-slide data-title="B">B</section><section data-zclaudia-slide data-title="A">A</section></body>');
  });

  it('returns the source untouched when from equals to', () => {
    expect(reorderDeckSlides(SIBLING_DECK, 1, 1)).toBe(SIBLING_DECK);
  });

  it('rejects out-of-bounds indexes with INVALID_VALUE', () => {
    expectDeckError(() => reorderDeckSlides(SIBLING_DECK, -1, 0), 'INVALID_VALUE');
    expectDeckError(() => reorderDeckSlides(SIBLING_DECK, 0, 3), 'INVALID_VALUE');
    expectDeckError(() => reorderDeckSlides(SIBLING_DECK, Number.NaN, 0), 'INVALID_VALUE');
    expectDeckError(() => reorderDeckSlides('<body></body>', 0, 0), 'INVALID_VALUE');
  });

  it('rejects non-sibling slides with STRUCTURE_NOT_ALLOWED', () => {
    expectDeckError(() => reorderDeckSlides(NESTED_DECK, 0, 1), 'STRUCTURE_NOT_ALLOWED');
  });

  it('propagates MALFORMED_HTML from parsing', () => {
    expectDeckError(() => reorderDeckSlides('', 0, 0), 'MALFORMED_HTML');
  });
});

describe('updateDeckSlideTitle', () => {
  it('escapes quotes, ampersands and angle brackets and reads back the original', () => {
    const title = '他说 "你好" & <再会>';
    const next = updateDeckSlideTitle(NESTED_DECK, 0, title);
    expect(next).toContain('data-title="他说 &quot;你好&quot; &amp; &lt;再会&gt;"');
    expect(parseDeck(next).slides[0]!.title).toBe(title);
    expect(parseDeck(next).slides[0]!.notes).toBe('备注 A');
  });

  it('replaces only the attribute span when data-title already exists', () => {
    const source = '<body><section data-zclaudia-slide data-title="旧标题" data-notes="n">A</section></body>';
    const next = updateDeckSlideTitle(source, 0, '新"标题"');
    expect(next).toBe(
      '<body><section data-zclaudia-slide data-title="新&quot;标题&quot;" data-notes="n">A</section></body>'
    );
  });

  it('inserts a new attribute before the closing bracket when absent', () => {
    const source = '<body><section data-zclaudia-slide>A</section></body>';
    const next = updateDeckSlideTitle(source, 0, 'T&1');
    expect(next).toBe('<body><section data-zclaudia-slide data-title="T&amp;1">A</section></body>');
    expect(parseDeck(next).slides[0]!.title).toBe('T&1');
  });

  it('rejects over-length titles and control characters', () => {
    expectDeckError(() => updateDeckSlideTitle(NESTED_DECK, 0, '标'.repeat(201)), 'INVALID_VALUE');
    expect(updateDeckSlideTitle(NESTED_DECK, 0, '标'.repeat(200))).toBeDefined();
    expectDeckError(() => updateDeckSlideTitle(NESTED_DECK, 0, 'a\nb'), 'INVALID_VALUE');
  });

  it('rejects out-of-bounds indexes and propagates MALFORMED_HTML', () => {
    expectDeckError(() => updateDeckSlideTitle(NESTED_DECK, 3, 'x'), 'INVALID_VALUE');
    expectDeckError(() => updateDeckSlideTitle('', 0, 'x'), 'MALFORMED_HTML');
  });
});

describe('updateDeckSlideNotes', () => {
  it('escapes and round-trips notes containing quotes and ampersands', () => {
    const notes = `备注 "1" & <2>`;

    const next = updateDeckSlideNotes(NESTED_DECK, 1, notes);
    expect(next).toContain('data-notes="备注 &quot;1&quot; &amp; &lt;2&gt;"');
    expect(parseDeck(next).slides[1]!.notes).toBe(notes);
  });

  it('replaces an existing notes span and leaves other bytes untouched', () => {
    const source = '<body><section data-zclaudia-slide data-notes="旧" data-title="t">A</section></body>';
    const next = updateDeckSlideNotes(source, 0, '新&备注');
    expect(next).toBe(
      '<body><section data-zclaudia-slide data-notes="新&amp;备注" data-title="t">A</section></body>'
    );
  });

  it('inserts notes on a slide without the attribute', () => {
    const source = '<body><section data-zclaudia-slide class="x">A</section></body>';
    const next = updateDeckSlideNotes(source, 0, 'n"1');
    expect(next).toBe('<body><section data-zclaudia-slide class="x" data-notes="n&quot;1">A</section></body>');
  });

  it('enforces the 2000-character limit and rejects control characters', () => {
    expect(updateDeckSlideNotes(NESTED_DECK, 0, 'n'.repeat(2000))).toBeDefined();
    expectDeckError(() => updateDeckSlideNotes(NESTED_DECK, 0, 'n'.repeat(2001)), 'INVALID_VALUE');
    expectDeckError(() => updateDeckSlideNotes(NESTED_DECK, 0, 'a\tb'), 'INVALID_VALUE');
    expectDeckError(() => updateDeckSlideNotes(NESTED_DECK, 0, 'a\u0000b'), 'INVALID_VALUE');
  });

  it('rejects out-of-bounds indexes and propagates MALFORMED_HTML', () => {
    expectDeckError(() => updateDeckSlideNotes(NESTED_DECK, -1, 'n'), 'INVALID_VALUE');
    expectDeckError(() => updateDeckSlideNotes('', 0, 'n'), 'MALFORMED_HTML');
  });
});

describe('setDeckRatio', () => {
  it('replaces an existing ratio attribute span', () => {
    const source = '<body data-zclaudia-deck-ratio="16:9"><section data-zclaudia-slide>A</section></body>';
    const next = setDeckRatio(source, '4:3');
    expect(next).toBe('<body data-zclaudia-deck-ratio="4:3"><section data-zclaudia-slide>A</section></body>');
    expect(parseDeck(next).ratio).toBe('4:3');
  });

  it('inserts the ratio attribute on a body without one', () => {
    const source = '<body>\n  <section data-zclaudia-slide>A</section>\n</body>';
    const next = setDeckRatio(source, '4:3');
    expect(next).toBe('<body data-zclaudia-deck-ratio="4:3">\n  <section data-zclaudia-slide>A</section>\n</body>');
  });

  it('inserts after the last existing body attribute', () => {
    const source = '<body class="page"><section data-zclaudia-slide>A</section></body>';
    const next = setDeckRatio(source, '16:9');
    expect(next).toBe('<body class="page" data-zclaudia-deck-ratio="16:9"><section data-zclaudia-slide>A</section></body>');
  });

  it('rejects unknown ratios and pages without a real body', () => {
    expectDeckError(() => setDeckRatio(NESTED_DECK, '3:2' as DeckRatio), 'INVALID_VALUE');
    expectDeckError(() => setDeckRatio('', '16:9'), 'MALFORMED_HTML');
  });
});

describe('addDeckSlide', () => {
  it('appends the template before </body> aligned to the last slide indent', () => {
    const source = '<!doctype html>\n<html><body>\n  <section data-zclaudia-slide data-title="A">A</section>\n</body></html>';
    const result = addDeckSlide(source);
    expect(result.index).toBe(1);
    expect(result.source).toBe(
      '<!doctype html>\n<html><body>\n  <section data-zclaudia-slide data-title="A">A</section>\n' +
        '  <section data-zclaudia-slide data-title="新页">\n' +
        '    <h2>新页标题</h2>\n' +
        '    <p>在此填写内容。</p>\n' +
        '  </section>\n</body></html>'
    );
    const info = parseDeck(result.source);
    expect(info.slides).toHaveLength(2);
    expect(info.slides[1]!.title).toBe('新页');
    expect(info.slides[1]!.notes).toBe('');
    expect(info.siblings).toBe(true);
  });

  it('aligns to a deeper indent and returns the next index', () => {
    const source = '<body>\n    <section data-zclaudia-slide>A</section>\n</body>';
    const result = addDeckSlide(source);
    expect(result.index).toBe(1);
    expect(result.source).toContain('\n    <section data-zclaudia-slide data-title="新页">');
    expect(result.source).toContain('\n      <h2>新页标题</h2>');
  });

  it('uses two-space indent when the page has no slides yet', () => {
    const source = '<body>\n  <p>普通页</p>\n</body>';
    const result = addDeckSlide(source);
    expect(result.index).toBe(0);
    expect(result.source).toContain('\n  <section data-zclaudia-slide data-title="新页">');
    expect(parseDeck(result.source).slides).toHaveLength(1);
  });

  it('keeps the original closing indent before </body>', () => {
    const source = '<body>\n  <section data-zclaudia-slide>A</section>\n  </body>';
    const result = addDeckSlide(source);
    expect(result.source).toContain('  </section>\n  </body>');
    expect(parseDeck(result.source).slides).toHaveLength(2);
  });

  it('rejects adding past the 60-page cap and malformed pages', () => {
    const source = `<body>${'<section data-zclaudia-slide></section>'.repeat(60)}</body>`;
    expectDeckError(() => addDeckSlide(source), 'STRUCTURE_NOT_ALLOWED');
    expectDeckError(() => addDeckSlide(''), 'MALFORMED_HTML');
  });
});

describe('deleteDeckSlide', () => {
  it('removes exactly the element span and keeps the other slides', () => {
    const before = parseDeck(NESTED_DECK);
    const removed = before.slides[1]!.span;
    const next = deleteDeckSlide(NESTED_DECK, 1);
    expect(next).toBe(NESTED_DECK.slice(0, removed.start) + NESTED_DECK.slice(removed.end));
    const after = parseDeck(next);
    expect(after.slides.map(slide => slide.title)).toEqual(['第一页', '第三页']);
    expect(after.slides.map(slide => slide.index)).toEqual([0, 1]);
  });

  it('degrades to a plain page when the last slide is removed', () => {
    const source = '<body>\n  <section data-zclaudia-slide data-title="A">A</section>\n</body>';
    const next = deleteDeckSlide(source, 0);
    expect(parseDeck(next).slides).toHaveLength(0);
    expect(isDeck(next)).toBe(false);
    // 页面仍是合法 HTML。
    expect(next).toContain('<body>');
  });

  it('rejects out-of-bounds indexes and propagates MALFORMED_HTML', () => {
    expectDeckError(() => deleteDeckSlide(NESTED_DECK, 3), 'INVALID_VALUE');
    expectDeckError(() => deleteDeckSlide('', 0), 'MALFORMED_HTML');
  });
});

describe('filterSlideInPreviewHtml', () => {
  const previewHtml = `<!doctype html>
<html><head><title>t</title><script>bridge();</script></head>
<body>
<section data-zclaudia-slide data-title="A"><h1>第一页</h1></section>
<p>marker</p>
<section data-zclaudia-slide data-title="B"><script>pageTwo();</script><h1>第二页</h1></section>
<script>tail();</script>
</body></html>`;

  function parse(html: string): Document {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  it('shows only the requested slide and removes every script', () => {
    const output = filterSlideInPreviewHtml(previewHtml, 0);
    expect(output.startsWith('<!doctype html>')).toBe(true);
    const doc = parse(output);
    expect(doc.querySelectorAll('script')).toHaveLength(0);
    expect(doc.querySelectorAll('[data-zclaudia-slide]')).toHaveLength(2);
    const active = doc.querySelectorAll('[data-zclaudia-slide-active]');
    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute('data-title')).toBe('A');
    const style = doc.querySelector('head style');
    expect(style?.textContent).toContain('[data-zclaudia-slide]{display:none!important}');
    expect(style?.textContent).toContain(
      '[data-zclaudia-slide][data-zclaudia-slide-active]{display:block!important}'
    );
  });

  it('activates the slide at the requested document-order index', () => {
    const doc = parse(filterSlideInPreviewHtml(previewHtml, 1));
    const active = doc.querySelectorAll('[data-zclaudia-slide-active]');
    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute('data-title')).toBe('B');
    expect(doc.querySelectorAll('script')).toHaveLength(0);
  });

  it('throws INVALID_VALUE for out-of-bounds indexes', () => {
    expectDeckError(() => filterSlideInPreviewHtml(previewHtml, 2), 'INVALID_VALUE');
    expectDeckError(() => filterSlideInPreviewHtml(previewHtml, -1), 'INVALID_VALUE');
    expectDeckError(() => filterSlideInPreviewHtml('<body><p>无页</p></body>', 0), 'INVALID_VALUE');
  });
});
