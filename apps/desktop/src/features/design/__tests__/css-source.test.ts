import { describe, expect, it } from 'vitest';
import { buildStyleRules, patchCssText, type CssRuleRow, type CssSourceEdit } from '../css-source';
import { STYLE_BLOCK_MAX_BYTES, DesignEditError, type DesignMatchedRule } from '../types';

const matchedRule = (
  overrides: Partial<DesignMatchedRule> & Pick<DesignMatchedRule, 'origin' | 'rulePath' | 'selectorText'>
): DesignMatchedRule => ({
  specificity: [0, 1, 0],
  importantProps: [],
  ...overrides,
});

const build = (
  htmlSource: string,
  matched: DesignMatchedRule[],
  computed: Partial<Record<string, string>> = {},
  inlineStyle: string | null = null
): CssRuleRow[] => buildStyleRules({ htmlSource, matched, computed, inlineStyle });

/**
 * 入口两个 <style> 块：块 0 含注释（占索引但不产出规则）与 !important 声明，
 * 块 1 含 @media 嵌套规则（rulePath [0, 0]）。
 */
const SOURCE = [
  '<!doctype html>',
  '<html>',
  '<head>',
  '  <style>',
  '    body { margin-top: 0; }',
  '    /* page card */',
  '    .card { color: #f00; padding-top: 8px; font-weight: bold !important; }',
  '    div p { line-height: 1.5; }',
  '  </style>',
  '  <style>',
  '    @media (min-width: 600px) {',
  '      .card { color: #00f; }',
  '    }',
  '  </style>',
  '</head>',
  '<body><div class="card"><p>hi</p></div></body>',
  '</html>',
].join('\n');

const declSource = (row: CssRuleRow, index: number): string =>
  SOURCE.slice(row.declarations[index].start, row.declarations[index].end);

describe('css-source（P3.5 C2：宿主侧源码对齐与规则模型）', () => {
  describe('对齐命中与声明偏移', () => {
    it('多 <style> 块 + @media 嵌套 rulePath 命中；行序跟随 matched（预览 DOM 序）', () => {
      const rows = build(
        SOURCE,
        [
          matchedRule({ origin: '@inline/1', rulePath: [0, 0], selectorText: '.card' }),
          matchedRule({ origin: '@inline/0', rulePath: [2], selectorText: '.card' }),
        ],
        { color: 'rgb(0, 0, 255)' }
      );
      expect(rows.map(row => row.origin)).toEqual(['@inline/1', '@inline/0']);
      expect(rows.every(row => row.readOnly === null)).toBe(true);
      // 身份字段透传（展示用桥接原文，非 postcss 反推）。
      expect(rows[1]).toMatchObject({ selectorText: '.card', rulePath: [2], specificity: [0, 1, 0] });
      expect(rows[0].declarations.map(d => `${d.property}: ${d.value}`)).toEqual(['color: #00f']);
    });

    it('声明行携带绝对偏移：按 start/end、valueStart/valueEnd 切片等于声明原文', () => {
      const rows = build(SOURCE, [matchedRule({ origin: '@inline/0', rulePath: [2], selectorText: '.card' })]);
      const row = rows[0];
      expect(row.readOnly).toBeNull();
      expect(row.declarations.map(d => d.property)).toEqual(['color', 'padding-top', 'font-weight']);
      const [color, padding, weight] = row.declarations;
      // 声明整体与值子区间均为 htmlSource 绝对偏移，可直接切片还原。
      expect(SOURCE.slice(color.start, color.end)).toBe('color: #f00');
      expect(SOURCE.slice(color.valueStart, color.valueEnd)).toBe('#f00');
      expect(SOURCE.slice(padding.start, padding.end)).toBe('padding-top: 8px');
      expect(SOURCE.slice(padding.valueStart, padding.valueEnd)).toBe('8px');
      // !important 计入声明整体、不计入值子区间。
      expect(weight.important).toBe(true);
      expect(SOURCE.slice(weight.start, weight.end)).toBe('font-weight: bold !important');
      expect(SOURCE.slice(weight.valueStart, weight.valueEnd)).toBe('bold');
      expect(weight.editable).toBe(true);
      // 同块内其他声明不带 important。
      expect(color.important).toBe(false);
    });

    it('嵌套 @media 内声明的偏移同样指向 htmlSource 绝对位置', () => {
      const rows = build(SOURCE, [matchedRule({ origin: '@inline/1', rulePath: [0, 0], selectorText: '.card' })]);
      const color = rows[0].declarations[0];
      expect(SOURCE.slice(color.start, color.end)).toBe('color: #00f');
      expect(color.valueStart).toBe(SOURCE.indexOf('#00f'));
    });

    it('选择器指纹归一：trim + 连续空白折叠后严格相等（不做模糊匹配）', () => {
      const rows = build(SOURCE, [
        matchedRule({ origin: '@inline/0', rulePath: [3], selectorText: 'div   p' }),
        matchedRule({ origin: '@inline/0', rulePath: [2], selectorText: '  .card  ' }),
      ]);
      expect(rows[0].readOnly).toBeNull();
      expect(rows[0].declarations.map(d => d.property)).toEqual(['line-height']);
      expect(rows[1].readOnly).toBeNull();
    });

    it('非 Rule/AtRule 节点计入索引但不产出规则：注释占据索引 1', () => {
      const rows = build(SOURCE, [matchedRule({ origin: '@inline/0', rulePath: [1], selectorText: '.card' })]);
      expect(rows[0].readOnly).toEqual({ reason: 'align-mismatch' });
      expect(rows[0].declarations).toEqual([]);
    });
  });

  describe('只读原因', () => {
    it('selectorText 被改写 → align-mismatch', () => {
      const rows = build(SOURCE, [matchedRule({ origin: '@inline/0', rulePath: [2], selectorText: '.cards' })]);
      expect(rows[0].readOnly).toEqual({ reason: 'align-mismatch' });
      expect(rows[0].declarations).toEqual([]);
    });

    it('rulePath 越界 / 中间级非 AtRule / 空 rulePath → align-mismatch', () => {
      const rows = build(SOURCE, [
        matchedRule({ origin: '@inline/0', rulePath: [9], selectorText: '.card' }),
        matchedRule({ origin: '@inline/0', rulePath: [0, 0], selectorText: 'body' }),
        matchedRule({ origin: '@inline/0', rulePath: [], selectorText: 'body' }),
      ]);
      expect(rows.map(row => row.readOnly)).toEqual([
        { reason: 'align-mismatch' },
        { reason: 'align-mismatch' },
        { reason: 'align-mismatch' },
      ]);
    });

    it('origin 序号不存在或非数字 → align-mismatch', () => {
      const rows = build(SOURCE, [
        matchedRule({ origin: '@inline/7', rulePath: [0], selectorText: '.card' }),
        matchedRule({ origin: '@inline/abc', rulePath: [0], selectorText: '.card' }),
      ]);
      expect(rows.map(row => row.readOnly)).toEqual([
        { reason: 'align-mismatch' },
        { reason: 'align-mismatch' },
      ]);
    });

    it('postcss 解析失败（未闭合大括号）→ 该块 parse-error，其余块不受影响', () => {
      const source = '<style>\n  .card { color: red;\n</style>\n<style>\n  .ok { color: blue; }\n</style>';
      const rows = build(source, [
        matchedRule({ origin: '@inline/0', rulePath: [0], selectorText: '.card' }),
        matchedRule({ origin: '@inline/1', rulePath: [0], selectorText: '.ok' }),
      ]);
      expect(rows[0].readOnly).toEqual({ reason: 'parse-error' });
      expect(rows[0].declarations).toEqual([]);
      expect(rows[1].readOnly).toBeNull();
      expect(rows[1].declarations[0]).toMatchObject({ property: 'color', value: 'blue', editable: true });
    });

    it('块文本超过 STYLE_BLOCK_MAX_BYTES → 该块 oversize，小块不受影响', () => {
      const big = `<style>.big{color:red;${' '.repeat(STYLE_BLOCK_MAX_BYTES)}}</style>`;
      const source = `${big}\n<style>.ok { color: blue; }</style>`;
      const rows = build(source, [
        matchedRule({ origin: '@inline/0', rulePath: [0], selectorText: '.big' }),
        matchedRule({ origin: '@inline/1', rulePath: [0], selectorText: '.ok' }),
      ]);
      expect(rows[0].readOnly).toEqual({ reason: 'oversize' });
      expect(rows[0].declarations).toEqual([]);
      expect(rows[1].readOnly).toBeNull();
    });

    it('非 @inline origin（外部 .css 路径）→ external-css-readonly', () => {
      const rows = build(SOURCE, [
        matchedRule({ origin: 'design/css/main.css', rulePath: [0], selectorText: '.card' }),
      ]);
      expect(rows[0].readOnly).toEqual({ reason: 'external-css-readonly' });
      expect(rows[0].declarations).toEqual([]);
      expect(rows[0].selectorText).toBe('.card');
    });
  });

  describe('winning 判定', () => {
    const single = (css: string): CssRuleRow[] =>
      build(`<style>${css}</style>`, [matchedRule({ origin: '@inline/0', rulePath: [0], selectorText: '.card' })]);

    it('颜色等价：#f00 与 rgb(255,0,0) 等值标 true，异色标 false，缺 computed 为 null', () => {
      expect(single('.card { color: #f00; }')[0].declarations[0].winning).toBeNull();
      expect(
        build(
          '<style>.card { color: #f00; }</style>',
          [matchedRule({ origin: '@inline/0', rulePath: [0], selectorText: '.card' })],
          { color: 'rgb(255, 0, 0)' }
        )[0].declarations[0].winning
      ).toBe(true);
      expect(
        build(
          '<style>.card { color: #f00; }</style>',
          [matchedRule({ origin: '@inline/0', rulePath: [0], selectorText: '.card' })],
          { color: '#00ff00' }
        )[0].declarations[0].winning
      ).toBe(false);
    });

    it('font-weight：bold 与 700 等值；px 长度按数值比较', () => {
      const weight = (computed: Partial<Record<string, string>>): boolean | null =>
        build(
          '<style>.card { font-weight: bold; }</style>',
          [matchedRule({ origin: '@inline/0', rulePath: [0], selectorText: '.card' })],
          computed
        )[0].declarations[0].winning;
      expect(weight({ 'font-weight': '700' })).toBe(true);
      expect(weight({ 'font-weight': '400' })).toBe(false);

      const width = (css: string, computed: Partial<Record<string, string>>): boolean | null =>
        build(
          `<style>.card { width: ${css}; }</style>`,
          [matchedRule({ origin: '@inline/0', rulePath: [0], selectorText: '.card' })],
          computed
        )[0].declarations[0].winning;
      expect(width('100px', { width: '100px' })).toBe(true);
      expect(width('100px', { width: '50px' })).toBe(false);
      // 非纯 px 写法无可靠口径 → null。
      expect(width('10em', { width: '160px' })).toBeNull();
    });

    it('非计算键 / 无口径属性一律 null（display、font-family）', () => {
      expect(
        build(
          '<style>.card { display: flex; }</style>',
          [matchedRule({ origin: '@inline/0', rulePath: [0], selectorText: '.card' })],
          { display: 'flex' }
        )[0].declarations[0].winning
      ).toBeNull();
      expect(
        build(
          '<style>.card { font-family: serif; }</style>',
          [matchedRule({ origin: '@inline/0', rulePath: [0], selectorText: '.card' })],
          { 'font-family': 'serif' }
        )[0].declarations[0].winning
      ).toBeNull();
    });

    it('inline 声明优先级压过规则：规则行标 false（inline 失配时也不回标 true）', () => {
      const source = '<style>.card { color: #f00; }</style>';
      const rule = matchedRule({ origin: '@inline/0', rulePath: [0], selectorText: '.card' });
      expect(build(source, [rule], { color: 'rgb(0, 255, 0)' }, 'color: #0f0')[0].declarations[0].winning).toBe(
        false
      );
      expect(build(source, [rule], { color: '#f00' }, 'color: #0f0')[0].declarations[0].winning).toBe(false);
    });

    it('specificity 参与级联序：高特异性规则源码在先仍胜出', () => {
      const source = '<style>#main .card { color: #0f0; } .card { color: #f00; }</style>';
      const rows = build(
        source,
        [
          matchedRule({ origin: '@inline/0', rulePath: [0], selectorText: '#main .card', specificity: [1, 1, 0] }),
          matchedRule({ origin: '@inline/0', rulePath: [1], selectorText: '.card', specificity: [0, 1, 0] }),
        ],
        { color: 'rgb(0, 255, 0)' }
      );
      expect(rows[0].declarations[0].winning).toBe(true);
      expect(rows[1].declarations[0].winning).toBe(false);
    });

    it('同特异性时源码后写胜；!important 不做 winning 反转', () => {
      const source = '<style>.card { color: #f00 !important; } .card { color: #0f0; }</style>';
      const rows = build(
        source,
        [
          matchedRule({ origin: '@inline/0', rulePath: [0], selectorText: '.card', importantProps: ['color'] }),
          matchedRule({ origin: '@inline/0', rulePath: [1], selectorText: '.card' }),
        ],
        { color: 'rgb(0, 255, 0)' }
      );
      // 后写的普通声明是级联末位并等值 → true；!important 前者不反转。
      expect(rows[1].declarations[0].winning).toBe(true);
      expect(rows[0].declarations[0].winning).toBe(false);
    });

    it('多块同属性：同特异性后块胜出并与计算值等值时标 true，前块标 false', () => {
      const rows = build(
        SOURCE,
        [
          matchedRule({ origin: '@inline/0', rulePath: [2], selectorText: '.card' }),
          matchedRule({ origin: '@inline/1', rulePath: [0, 0], selectorText: '.card' }),
        ],
        { color: 'rgb(0, 0, 255)' }
      );
      expect(rows[0].declarations[0].winning).toBe(false);
      expect(rows[1].declarations[0].winning).toBe(true);
      // 非 21 键属性保持 null。
      expect(rows[0].declarations[1].winning).toBeNull();
      expect(rows[0].declarations[2].winning).toBeNull();
      expect(declSource(rows[0], 0)).toBe('color: #f00');
    });
  });

  describe('外部 cssSources 对齐（P3.5 第二批 C6）', () => {
    const CSS_FILE = [
      'h1 {',
      '  color: #ff0000;',
      '  padding-top: 8px;',
      '}',
      '@media (min-width: 600px) {',
      '  .card { color: #00f }',
      '}',
    ].join('\n');

    const buildExternal = (
      matched: DesignMatchedRule[],
      cssSources?: Record<string, { source: string; revision: string }>,
      computed: Partial<Record<string, string>> = {}
    ): CssRuleRow[] =>
      buildStyleRules({
        htmlSource: '<html><body><div class="card"><p>hi</p></div></body></html>',
        matched,
        computed,
        inlineStyle: null,
        ...(cssSources ? { cssSources } : {}),
      });

    const cssSource = (source: string): Record<string, { source: string; revision: string }> => ({
      'design/css/main.css': { source, revision: 'rev-css-1' },
    });

    it('cssSources 命中的外部 origin 按同款指纹对齐，产出可编辑声明行', () => {
      const rows = buildExternal(
        [matchedRule({ origin: 'design/css/main.css', rulePath: [0], selectorText: 'h1' })],
        cssSource(CSS_FILE)
      );
      expect(rows[0].readOnly).toBeNull();
      expect(rows[0].declarations.map(d => d.property)).toEqual(['color', 'padding-top']);
      expect(rows[0].declarations.every(d => d.editable)).toBe(true);
      expect(rows[0].declarations[0]).toMatchObject({ value: '#ff0000', important: false });
    });

    it('外部声明行偏移为该 css 文件内偏移（切片还原声明原文）', () => {
      const rows = buildExternal(
        [matchedRule({ origin: 'design/css/main.css', rulePath: [0], selectorText: 'h1' })],
        cssSource(CSS_FILE)
      );
      const [color, padding] = rows[0].declarations;
      expect(CSS_FILE.slice(color.start, color.end)).toBe('color: #ff0000');
      expect(CSS_FILE.slice(color.valueStart, color.valueEnd)).toBe('#ff0000');
      expect(CSS_FILE.slice(padding.start, padding.end)).toBe('padding-top: 8px');
    });

    it('@media 嵌套 rulePath 与选择器归一比对同口径', () => {
      const rows = buildExternal(
        [
          matchedRule({ origin: 'design/css/main.css', rulePath: [1, 0], selectorText: '.card' }),
          matchedRule({ origin: 'design/css/main.css', rulePath: [0], selectorText: '  h1  ' }),
        ],
        cssSource(CSS_FILE)
      );
      expect(rows.every(row => row.readOnly === null)).toBe(true);
      expect(rows[0].declarations[0]).toMatchObject({ property: 'color', value: '#00f' });
      expect(rows[1].declarations.map(d => d.property)).toEqual(['color', 'padding-top']);
    });

    it('cssSources 未提供 → external-css-readonly；提供但缺该路径同样只读', () => {
      const rule = matchedRule({ origin: 'design/css/main.css', rulePath: [0], selectorText: 'h1' });
      expect(buildExternal([rule])[0].readOnly).toEqual({ reason: 'external-css-readonly' });
      expect(buildExternal([rule], cssSource(CSS_FILE), {})[0].readOnly).toBeNull();
      expect(
        buildExternal([rule], { 'design/css/other.css': { source: CSS_FILE, revision: 'r' } })[0].readOnly
      ).toEqual({ reason: 'external-css-readonly' });
    });

    it('css 文本解析失败 → parse-error（该文件规则全部只读）', () => {
      const rows = buildExternal(
        [matchedRule({ origin: 'design/css/main.css', rulePath: [0], selectorText: 'h1' })],
        cssSource('h1 { color: red;')
      );
      expect(rows[0].readOnly).toEqual({ reason: 'parse-error' });
      expect(rows[0].declarations).toEqual([]);
    });

    it('选择器指纹不符 → align-mismatch', () => {
      const rows = buildExternal(
        [matchedRule({ origin: 'design/css/main.css', rulePath: [0], selectorText: 'h2' })],
        cssSource(CSS_FILE)
      );
      expect(rows[0].readOnly).toEqual({ reason: 'align-mismatch' });
      expect(rows[0].declarations).toEqual([]);
    });

    it('rulePath 越界 → align-mismatch；css 文本超 STYLE_BLOCK_MAX_BYTES → oversize', () => {
      const rows = buildExternal(
        [matchedRule({ origin: 'design/css/main.css', rulePath: [9], selectorText: 'h1' })],
        cssSource(CSS_FILE)
      );
      expect(rows[0].readOnly).toEqual({ reason: 'align-mismatch' });
      const big = `h1 { color: red;${' '.repeat(STYLE_BLOCK_MAX_BYTES)} }`;
      const oversize = buildExternal(
        [matchedRule({ origin: 'design/css/main.css', rulePath: [0], selectorText: 'h1' })],
        cssSource(big)
      );
      expect(oversize[0].readOnly).toEqual({ reason: 'oversize' });
    });

    it('外部 origin 与 @inline 混合：各自对齐互不影响', () => {
      const rows = buildStyleRules({
        htmlSource: '<style>.card { color: #f00; }</style>',
        matched: [
          matchedRule({ origin: 'design/css/main.css', rulePath: [0], selectorText: 'h1' }),
          matchedRule({ origin: '@inline/0', rulePath: [0], selectorText: '.card' }),
        ],
        computed: {},
        inlineStyle: null,
        cssSources: cssSource(CSS_FILE),
      });
      expect(rows[0].readOnly).toBeNull();
      expect(rows[1].readOnly).toBeNull();
      expect(rows[1].declarations[0]).toMatchObject({ property: 'color', value: '#f00' });
    });
  });

  describe('patchCssText（P3.5 第二批 C6：独立 CSS 补丁引擎）', () => {
    const CSS_FILE = [
      'h1 {',
      '  color: #f00;',
      '  padding-top: 8px;',
      '}',
      '.wrap {',
      '  border-style: solid',
      '}',
    ].join('\n');

    const patch = (edit: CssSourceEdit, source = CSS_FILE): string => patchCssText(source, edit);

    it('改值 / 删除 / 新增逐字节保持（与 `<style>` 块 splice 同一引擎）', () => {
      expect(patch({ rulePath: [0], property: 'color', value: '#ff0000', create: false })).toBe(
        CSS_FILE.replace('color: #f00;', 'color: #ff0000;')
      );
      expect(patch({ rulePath: [0], property: 'padding-top', value: null, create: false })).toBe(
        CSS_FILE.replace('\n  padding-top: 8px;', '')
      );
      expect(patch({ rulePath: [1], property: 'margin-top', value: '4px', create: true })).toBe(
        CSS_FILE.replace('  border-style: solid\n}', '  border-style: solid\n;\n  margin-top: 4px;}')
      );
    });

    it('非法值 / 定位失败抛 DesignEditError 且原文不动（纯函数不落盘）', () => {
      expect(() =>
        patch({ rulePath: [0], property: 'color', value: 'a;b', create: false })
      ).toThrowError(DesignEditError);
      expect(() =>
        patch({ rulePath: [7], property: 'color', value: 'blue', create: false })
      ).toThrowError(DesignEditError);
      expect(() => patch({ rulePath: [0], property: 'display', value: null, create: false })).toThrowError(
        DesignEditError
      );
    });
  });
});
