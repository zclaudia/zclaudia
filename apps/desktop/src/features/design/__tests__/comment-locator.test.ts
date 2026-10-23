import { describe, expect, it } from 'vitest';
import type { DesignShareCommentTarget } from '../api';
import { matchCommentTarget, normalizeText, truncateText } from '../comment-locator';

const target = (overrides: Partial<DesignShareCommentTarget>): DesignShareCommentTarget => ({
  elementPath: [0],
  tagName: 'div',
  text: 'hello',
  ...overrides,
});

describe('normalizeText / truncateText（可测纯 helper）', () => {
  it('normalizeText：折叠 \\s+ 为单空格并去首尾', () => {
    expect(normalizeText('  hello \n\t world  ')).toBe('hello world');
    expect(normalizeText('你好   世界')).toBe('你好 世界');
    expect(normalizeText('')).toBe('');
  });

  it('truncateText：总长 ≤ max，超长以 … 结尾', () => {
    expect(truncateText('abc', 5)).toBe('abc');
    expect(truncateText('abcde', 5)).toBe('abcde');
    expect(truncateText('abcdef', 5)).toBe('abcd…');
    expect(truncateText('abcdef', 5)).toHaveLength(5);
  });
});

describe('matchCommentTarget（P7 §6.1 严格定位）', () => {
  const PAGE = '<html><body><main><p id="intro">你好 世界</p><p>second</p></main></body></html>';

  it('target 为 null → 整页评论恒命中（无附加字段）', () => {
    expect(matchCommentTarget(PAGE, null)).toEqual({ matched: true });
  });

  it('命中：text 折叠 + snippet 为 sourceCodeLocation 源码切片', () => {
    const match = matchCommentTarget(
      PAGE,
      target({ elementPath: [0, 0], tagName: 'p', text: '你好 世界' })
    );
    expect(match.matched).toBe(true);
    expect(match.reason).toBeUndefined();
    expect(match.text).toBe('你好 世界');
    expect(match.snippet).toBe('<p id="intro">你好 世界</p>');
  });

  it('命中：文本节点不消耗 path 序号（元素子节点语义，与 element-tree 一致）', () => {
    const source = '<body>lead text<p>a</p><div>b</div></body>';
    const match = matchCommentTarget(source, target({ elementPath: [1], tagName: 'div', text: 'b' }));
    expect(match.matched).toBe(true);
    expect(match.snippet).toBe('<div>b</div>');
  });

  it('命中：折叠空白后相等即命中（源码多空白 / 目标已折叠的正例）', () => {
    const source = '<body><p>你好\n  世界</p></body>';
    const match = matchCommentTarget(source, target({ elementPath: [0], tagName: 'p', text: '你好 世界' }));
    expect(match.matched).toBe(true);
    expect(match.text).toBe('你好 世界');
  });

  it('命中：text 为后代文本拼接（textContent 语义）且 ≤200 超长截断', () => {
    const source = '<body><div><p>a</p> <span>b</span></div></body>';
    const nested = matchCommentTarget(source, target({ elementPath: [0], tagName: 'div', text: 'a b' }));
    expect(nested.matched).toBe(true);
    expect(nested.text).toBe('a b');

    const long = 'x'.repeat(300);
    const longSource = `<body><p>${long}</p></body>`;
    const longMatch = matchCommentTarget(
      longSource,
      target({ elementPath: [0], tagName: 'p', text: 'x'.repeat(199) + '…' })
    );
    expect(longMatch.matched).toBe(true);
    expect(longMatch.text).toHaveLength(200);
    expect(longMatch.text?.endsWith('…')).toBe(true);
  });

  it('命中：snippet 超 1200 截断（总长 ≤1200，… 结尾，内容取自源码切片开头）', () => {
    const source = `<body><div class="box">${'a'.repeat(1500)}</div></body>`;
    const match = matchCommentTarget(
      source,
      target({ elementPath: [0], tagName: 'div', text: 'a'.repeat(199) + '…' })
    );
    expect(match.matched).toBe(true);
    expect(match.snippet).toBeDefined();
    expect(match.snippet).toHaveLength(1200);
    expect(match.snippet?.startsWith('<div class="box">aaa')).toBe(true);
    expect(match.snippet?.endsWith('…')).toBe(true);
  });

  it('path-missing：元素被删除 / 深层越界 / 负数序号', () => {
    const deleted = matchCommentTarget('<body><div>a</div></body>', target({ elementPath: [1] }));
    expect(deleted).toEqual({ matched: false, reason: 'path-missing' });

    const deep = matchCommentTarget(
      PAGE,
      target({ elementPath: [0, 5], tagName: 'p', text: 'second' })
    );
    expect(deep.reason).toBe('path-missing');

    const negative = matchCommentTarget(PAGE, target({ elementPath: [-1] }));
    expect(negative.reason).toBe('path-missing');
  });

  it('tag-mismatch：路径命中但标签不符', () => {
    const match = matchCommentTarget(
      PAGE,
      target({ elementPath: [0, 0], tagName: 'div', text: '你好 世界' })
    );
    expect(match).toEqual({ matched: false, reason: 'tag-mismatch' });
  });

  it('text-mismatch：标签相符但折叠文本不等', () => {
    const match = matchCommentTarget(
      PAGE,
      target({ elementPath: [0, 0], tagName: 'p', text: '完全不同的文本' })
    );
    expect(match).toEqual({ matched: false, reason: 'text-mismatch' });
  });

  it('无显式 body 的文档：隐式 body 仍可定位；纯文本时 body 下无元素 → path-missing', () => {
    const implicit = matchCommentTarget(
      '<p>没有 body 标签</p>',
      target({ elementPath: [0], tagName: 'p', text: '没有 body 标签' })
    );
    expect(implicit.matched).toBe(true);
    expect(implicit.snippet).toBe('<p>没有 body 标签</p>');

    const empty = matchCommentTarget('just text, no elements', target({ elementPath: [0] }));
    expect(empty).toEqual({ matched: false, reason: 'path-missing' });
  });

  it('隐式节点（parse5 补全的 tbody）无 sourceCodeLocation：仍命中，text 有、snippet undefined', () => {
    const match = matchCommentTarget(
      '<body><table><tr><td>cell</td></tr></table></body>',
      target({ elementPath: [0, 0], tagName: 'tbody', text: 'cell' })
    );
    expect(match.matched).toBe(true);
    expect(match.text).toBe('cell');
    expect(match.snippet).toBeUndefined();
    const implicitBody = matchCommentTarget(
      '<p>implicit body</p>',
      target({ elementPath: [], tagName: 'body', text: 'implicit body' })
    );
    expect(implicitBody.matched).toBe(true);
    expect(implicitBody.snippet).toBeUndefined();
  });

  it('深度嵌套路径：70 层 div 仍可定位', () => {
    const depth = 70;
    const source = `<body>${'<div>'.repeat(depth)}leaf${'</div>'.repeat(depth)}</body>`;
    const match = matchCommentTarget(
      source,
      target({ elementPath: Array<number>(depth).fill(0), tagName: 'div', text: 'leaf' })
    );
    expect(match.matched).toBe(true);
    expect(match.text).toBe('leaf');
    expect(match.snippet).toContain('leaf');
    expect(match.snippet?.startsWith('<div>')).toBe(true);
  });
});
