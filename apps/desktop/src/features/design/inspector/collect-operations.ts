/**
 * Inspector 纯操作收集器（自 SelectionEditor 抽出）：样式字段定义、字段初始值，
 * 以及「草稿值 + 选区 + 计算样式 → 编辑操作 + 预检失败标签」的收集逻辑。
 * 与组件内原实现逐行为等价：颜色两字段保持宽松（非空即提交，引擎 safeColor 兜底），
 * 其余 style/attribute 字段逐个过 safeStyleValue/safeAttrValue 预检；
 * invalid 非空时由调用方决定整单丢弃。
 */

import { safeAttrValue, safeStyleValue } from '../html/values';
import type {
  DesignAttributeName,
  DesignEditOperation,
  DesignSelection,
  DesignStyleProperty,
} from '../types';

const TEXT_ALIGN_OPTIONS: readonly string[] = [
  'left',
  'center',
  'right',
  'justify',
  'start',
  'end',
];
const BORDER_STYLE_OPTIONS: readonly string[] = [
  'none',
  'hidden',
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
];
const OBJECT_FIT_OPTIONS: readonly string[] = ['fill', 'contain', 'cover', 'none', 'scale-down'];

export interface StyleFieldDef {
  property: DesignStyleProperty;
  label: string;
  kind: 'input' | 'select';
  options?: readonly string[];
  placeholder?: string;
}

export const TYPOGRAPHY_FIELDS: StyleFieldDef[] = [
  { property: 'font-family', label: 'Font', kind: 'input', placeholder: 'sans-serif' },
  { property: 'font-size', label: 'Font size', kind: 'input', placeholder: '16px' },
  { property: 'line-height', label: 'Line height', kind: 'input', placeholder: '1.5' },
  { property: 'font-weight', label: 'Weight', kind: 'input', placeholder: 'normal / bold / 400' },
  { property: 'text-align', label: 'Align', kind: 'select', options: TEXT_ALIGN_OPTIONS },
];

export const SIZE_FIELDS: StyleFieldDef[] = [
  { property: 'width', label: 'Width', kind: 'input', placeholder: 'auto' },
  { property: 'height', label: 'Height', kind: 'input', placeholder: 'auto' },
  { property: 'margin', label: 'Margin', kind: 'input', placeholder: '8px 12px' },
  { property: 'padding', label: 'Padding', kind: 'input', placeholder: '8px 12px' },
];

export const BORDER_FIELDS: StyleFieldDef[] = [
  { property: 'border-width', label: 'Border width', kind: 'input', placeholder: '1px' },
  { property: 'border-color', label: 'Border color', kind: 'input', placeholder: '#000000' },
  { property: 'border-radius', label: 'Radius', kind: 'input', placeholder: '4px' },
  {
    property: 'border-style',
    label: 'Border style',
    kind: 'select',
    options: BORDER_STYLE_OPTIONS,
  },
];

export const OBJECT_FIT_FIELD: StyleFieldDef = {
  property: 'object-fit',
  label: 'Fit',
  kind: 'select',
  options: OBJECT_FIT_OPTIONS,
};

/** 参与应用预检的全部样式字段（margin/padding 简写无计算值键，读取时按 undefined 处理）。 */
export const APPLICABLE_STYLE_FIELDS: StyleFieldDef[] = [
  ...TYPOGRAPHY_FIELDS,
  ...SIZE_FIELDS,
  ...BORDER_FIELDS,
  OBJECT_FIT_FIELD,
];

export type StyleValues = Partial<Record<DesignStyleProperty, string>>;

/** 编辑器各字段的草稿值快照（与 SelectionEditor 的 state 一一对应）。 */
export interface SelectionDraftValues {
  textValue: string;
  colorValue: string;
  backgroundValue: string;
  styleValues: StyleValues;
  srcValue: string;
  altValue: string;
  hrefValue: string;
}

/** 计算样式读取口径：margin/padding 等简写属性无计算键，统一按 undefined → 空串。 */
function computedStylesOf(
  selection: DesignSelection | null
): Partial<Record<DesignStyleProperty, string>> | undefined {
  return selection?.styles as Partial<Record<DesignStyleProperty, string>> | undefined;
}

/** 字段初始值：select 型仅当计算值命中选项时选中（大小写不敏感），否则空 = 不修改。 */
export function initialStyleValue(field: StyleFieldDef, selection: DesignSelection | null): string {
  const raw = computedStylesOf(selection)?.[field.property] ?? '';
  if (field.kind === 'select') {
    const keyword = raw.toLowerCase();
    return field.options?.includes(keyword) ? keyword : '';
  }
  return raw;
}

export function initialStyleValues(selection: DesignSelection | null): StyleValues {
  const values: StyleValues = {};
  for (const field of APPLICABLE_STYLE_FIELDS) {
    values[field.property] = initialStyleValue(field, selection);
  }
  return values;
}

/**
 * 收集待提交操作：与初始值不同且 trim 非空的字段；颜色两字段沿用宽松行为
 * （非空即提交，引擎 safeColor 兜底），其余 style/attribute 字段逐个过
 * safeStyleValue/safeAttrValue 预检——非法字段只记入 invalid（字段英文标签），
 * 不产生对应操作，其余操作照常收集；调用方在 invalid 非空时丢弃整单。
 */
export function collectOperations(
  values: SelectionDraftValues,
  selection: DesignSelection,
  computedStyles: Partial<Record<DesignStyleProperty, string>> | undefined
): { operations: DesignEditOperation[]; invalid: string[] } {
  const operations: DesignEditOperation[] = [];
  const invalid: string[] = [];
  if (values.textValue !== (selection.sourceText ?? selection.text)) {
    operations.push({ kind: 'text', value: values.textValue });
  }
  if (values.colorValue.trim() && values.colorValue !== (selection.color ?? '')) {
    operations.push({ kind: 'style', property: 'color', value: values.colorValue });
  }
  if (
    values.backgroundValue.trim() &&
    values.backgroundValue !== (selection.backgroundColor ?? '')
  ) {
    operations.push({ kind: 'style', property: 'background-color', value: values.backgroundValue });
  }
  for (const field of APPLICABLE_STYLE_FIELDS) {
    const value = values.styleValues[field.property] ?? '';
    if (!value.trim() || value === (computedStyles?.[field.property] ?? '')) continue;
    const safe = safeStyleValue(field.property, value);
    if (safe === null) {
      invalid.push(field.label);
      continue;
    }
    operations.push({ kind: 'style', property: field.property, value: safe });
  }
  const attributeFields: Array<{ name: DesignAttributeName; label: string; value: string }> = [];
  if (selection.tagName === 'img') {
    attributeFields.push(
      { name: 'src', label: 'Image URL', value: values.srcValue },
      { name: 'alt', label: 'Alt text', value: values.altValue }
    );
  }
  if (selection.tagName === 'a') {
    attributeFields.push({ name: 'href', label: 'Link URL', value: values.hrefValue });
  }
  for (const field of attributeFields) {
    if (!field.value.trim() || field.value === (selection.attrs?.[field.name] ?? '')) continue;
    const safe = safeAttrValue(field.name, field.value, selection.tagName);
    if (safe === null) {
      invalid.push(field.label);
      continue;
    }
    operations.push({ kind: 'attribute', name: field.name, value: safe });
  }
  return { operations, invalid };
}
