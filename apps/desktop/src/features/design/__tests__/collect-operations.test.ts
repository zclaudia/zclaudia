import { describe, expect, it } from 'vitest';
import {
  APPLICABLE_STYLE_FIELDS,
  BORDER_FIELDS,
  collectOperations,
  initialStyleValue,
  initialStyleValues,
  OBJECT_FIT_FIELD,
  SIZE_FIELDS,
  TYPOGRAPHY_FIELDS,
  type SelectionDraftValues,
  type StyleFieldDef,
} from '../inspector/collect-operations';
import type { DesignSelection, DesignStyleProperty } from '../types';

function selectionOf(overrides: Partial<DesignSelection> = {}): DesignSelection {
  return { elementPath: [0], tagName: 'p', text: 'Hello', ...overrides };
}

/** 与选区初始值完全一致的草稿（textValue 取 sourceText ?? text，其余取现值）。 */
function draftOf(
  selection: DesignSelection,
  overrides: Partial<SelectionDraftValues> = {}
): SelectionDraftValues {
  return {
    textValue: selection.sourceText ?? selection.text,
    colorValue: selection.color ?? '',
    backgroundValue: selection.backgroundColor ?? '',
    styleValues: initialStyleValues(selection),
    srcValue: selection.attrs?.src ?? '',
    altValue: selection.attrs?.alt ?? '',
    hrefValue: selection.attrs?.href ?? '',
    ...overrides,
  };
}

function fieldOf(fields: StyleFieldDef[], property: DesignStyleProperty): StyleFieldDef {
  const field = fields.find(candidate => candidate.property === property);
  if (!field) throw new Error(`missing field: ${property}`);
  return field;
}

describe('collect-operations（自 SelectionEditor 抽出的纯操作收集器）', () => {
  it('所有字段与初始值一致时返回空操作与空 invalid', () => {
    const selection = selectionOf({
      color: '#000000',
      backgroundColor: 'white',
      styles: { 'font-size': '16px', width: '100px', 'text-align': 'center' },
      attrs: { src: 'assets/a.png', alt: 'A', href: 'page.html' },
    });
    expect(collectOperations(draftOf(selection), selection, selection.styles)).toEqual({
      operations: [],
      invalid: [],
    });
  });

  it('文字变化产生 text 操作；sourceText 存在时以 sourceText 为基准', () => {
    const plain = selectionOf({ text: 'Hello' });
    expect(
      collectOperations(draftOf(plain, { textValue: 'New' }), plain, undefined).operations
    ).toEqual([{ kind: 'text', value: 'New' }]);

    const withSource = selectionOf({ text: 'Live', sourceText: 'Saved' });
    expect(collectOperations(draftOf(withSource), withSource, undefined).operations).toEqual([]);
    expect(
      collectOperations(draftOf(withSource, { textValue: 'Saved!' }), withSource, undefined)
        .operations
    ).toEqual([{ kind: 'text', value: 'Saved!' }]);
  });

  it('颜色宽松规则：trim 非空且与现值不同即提交，非法颜色也原样入操作（不走 safeStyleValue）', () => {
    const selection = selectionOf({ color: '#000000', backgroundColor: 'white' });
    // 相同值跳过、纯空白跳过。
    expect(
      collectOperations(
        draftOf(selection, { colorValue: '#000000', backgroundValue: '   ' }),
        selection,
        undefined
      )
    ).toEqual({ operations: [], invalid: [] });
    // 非法颜色照常提交，不进 invalid。
    const result = collectOperations(
      draftOf(selectionOf(), {
        colorValue: 'not-a-color',
        backgroundValue: 'expression(alert(1))',
      }),
      selectionOf(),
      undefined
    );
    expect(result.invalid).toEqual([]);
    expect(result.operations).toEqual([
      { kind: 'style', property: 'color', value: 'not-a-color' },
      { kind: 'style', property: 'background-color', value: 'expression(alert(1))' },
    ]);
  });

  it('非法 font-size 只记 invalid 标签且不产生该字段操作，其余操作照常收集', () => {
    const selection = selectionOf({ text: 'Hello' });
    const result = collectOperations(
      draftOf(selection, { styleValues: { 'font-size': 'huge', width: '100px' } }),
      selection,
      {}
    );
    expect(result.invalid).toEqual(['Font size']);
    expect(result.operations).toEqual([{ kind: 'style', property: 'width', value: '100px' }]);
  });

  it('style 字段：合法值经 safeStyleValue 规整（trim）后提交，select 非法选项记 invalid', () => {
    const selection = selectionOf({ text: 'Hello' });
    const result = collectOperations(
      draftOf(selection, {
        styleValues: { 'font-size': ' 18px ', 'border-radius': '4px 8px', 'text-align': 'middle' },
      }),
      selection,
      {}
    );
    expect(result.invalid).toEqual(['Align']);
    expect(result.operations).toEqual([
      { kind: 'style', property: 'font-size', value: '18px' },
      { kind: 'style', property: 'border-radius', value: '4px 8px' },
    ]);
  });

  it('属性按标签白名单：div 上 src/alt/href 变化被整体忽略', () => {
    const selection = selectionOf({ tagName: 'div' });
    const result = collectOperations(
      draftOf(selection, { srcValue: 'assets/x.png', altValue: 'x', hrefValue: 'page.html' }),
      selection,
      undefined
    );
    expect(result).toEqual({ operations: [], invalid: [] });
  });

  it('img：合法 src/alt 产生 attribute 操作；带 scheme 的 src 记 invalid「Image URL」', () => {
    const ok = selectionOf({ tagName: 'img', text: '' });
    expect(
      collectOperations(
        draftOf(ok, { srcValue: 'assets/photo.png', altValue: 'A photo' }),
        ok,
        undefined
      )
    ).toEqual({
      operations: [
        { kind: 'attribute', name: 'src', value: 'assets/photo.png' },
        { kind: 'attribute', name: 'alt', value: 'A photo' },
      ],
      invalid: [],
    });

    const bad = selectionOf({ tagName: 'img', text: '' });
    const result = collectOperations(
      draftOf(bad, { srcValue: 'https://cdn.example.com/photo.png' }),
      bad,
      undefined
    );
    expect(result.operations).toEqual([]);
    expect(result.invalid).toEqual(['Image URL']);
  });

  it('a：合法 href 产生 attribute 操作；javascript: 记 invalid「Link URL」', () => {
    const ok = selectionOf({ tagName: 'a' });
    expect(collectOperations(draftOf(ok, { hrefValue: 'page.html' }), ok, undefined)).toEqual({
      operations: [{ kind: 'attribute', name: 'href', value: 'page.html' }],
      invalid: [],
    });

    const bad = selectionOf({ tagName: 'a' });
    const result = collectOperations(
      draftOf(bad, { hrefValue: 'javascript:alert(1)' }),
      bad,
      undefined
    );
    expect(result.operations).toEqual([]);
    expect(result.invalid).toEqual(['Link URL']);
  });

  it('initialStyleValue：select 型大小写不敏感命中选项，未命中与 null 选区返回空串', () => {
    const align = fieldOf(TYPOGRAPHY_FIELDS, 'text-align');
    expect(initialStyleValue(align, selectionOf({ styles: { 'text-align': 'CENTER' } }))).toBe(
      'center'
    );
    expect(initialStyleValue(align, selectionOf({ styles: { 'text-align': 'middle' } }))).toBe('');
    expect(initialStyleValue(align, null)).toBe('');

    const fontSize = fieldOf(TYPOGRAPHY_FIELDS, 'font-size');
    expect(initialStyleValue(fontSize, selectionOf({ styles: { 'font-size': '16px' } }))).toBe(
      '16px'
    );
    expect(initialStyleValue(fontSize, null)).toBe('');
  });

  it('initialStyleValues：覆盖全部 14 个适用字段，margin/padding 简写按空串读取', () => {
    expect(APPLICABLE_STYLE_FIELDS).toHaveLength(14);
    expect([...TYPOGRAPHY_FIELDS, ...SIZE_FIELDS, ...BORDER_FIELDS, OBJECT_FIT_FIELD]).toEqual(
      APPLICABLE_STYLE_FIELDS
    );
    expect(initialStyleValues(selectionOf({ styles: { 'font-size': '16px' } }))).toEqual({
      'font-family': '',
      'font-size': '16px',
      'line-height': '',
      'font-weight': '',
      'text-align': '',
      width: '',
      height: '',
      margin: '',
      padding: '',
      'border-width': '',
      'border-color': '',
      'border-radius': '',
      'border-style': '',
      'object-fit': '',
    });
    expect(initialStyleValues(null)).toEqual(
      Object.fromEntries(APPLICABLE_STYLE_FIELDS.map(field => [field.property, '']))
    );
  });
});
