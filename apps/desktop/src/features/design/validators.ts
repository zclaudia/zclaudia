import { compareCssValues } from './html/style-compare';
import {
  STYLE_IMPORTANT_PROPS_MAX,
  STYLE_RULES_MAX,
  STYLE_RULE_SELECTOR_MAX,
  STYLE_SPECIFICITY_MAX,
} from './types';
import type {
  DesignComputedStyles,
  DesignMatchedRule,
  DesignRulesMessage,
  DesignSelection,
} from './types';

/** 预览桥接消息载荷的形状/上限校验（违规整体丢弃，不告警、不清选区）。 */
export const isValidSelection = (value: unknown): value is DesignSelection => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<DesignSelection>;
  return (
    Array.isArray(v.elementPath) &&
    v.elementPath.length <= 64 &&
    v.elementPath.every(i => Number.isInteger(i) && i >= 0 && i < 10000) &&
    typeof v.tagName === 'string' &&
    v.tagName.length <= 64 &&
    typeof v.text === 'string' &&
    v.text.length <= 20000 &&
    (v.sourceText === undefined ||
      (typeof v.sourceText === 'string' && v.sourceText.length <= 20000)) &&
    (v.color === undefined || typeof v.color === 'string') &&
    (v.backgroundColor === undefined || typeof v.backgroundColor === 'string') &&
    (v.base === undefined || typeof v.base === 'string') &&
    isValidComputedStyles(v.styles) &&
    isValidSelectionAttrs(v.attrs) &&
    (v.inlineStyle === undefined ||
      (typeof v.inlineStyle === 'string' && v.inlineStyle.length <= 2000))
  );
};

/** §6.1：styles 为普通对象（非 null/数组），键数 ≤32、值均为 string ≤200。 */
const isValidComputedStyles = (styles: unknown): boolean => {
  if (styles === undefined) return true;
  if (styles === null || typeof styles !== 'object' || Array.isArray(styles)) return false;
  const entries = Object.entries(styles as Record<string, unknown>);
  return entries.length <= 32 && entries.every(([, v]) => typeof v === 'string' && v.length <= 200);
};

/** §6.1：attrs 键 ∈ {src,alt,href}、值 string ≤500。 */
const isValidSelectionAttrs = (attrs: unknown): boolean => {
  if (attrs === undefined) return true;
  if (attrs === null || typeof attrs !== 'object' || Array.isArray(attrs)) return false;
  const entries = Object.entries(attrs as Record<string, unknown>);
  return entries.every(
    ([key, v]) =>
      (key === 'src' || key === 'alt' || key === 'href') && typeof v === 'string' && v.length <= 500
  );
};

/** P3.5 §2：单条匹配规则的字段形状与上限校验（上限常量与桥内裁剪同源 types.ts）。 */
export const isValidMatchedRule = (value: unknown): value is DesignMatchedRule => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Partial<DesignMatchedRule>;
  return (
    typeof v.origin === 'string' &&
    v.origin.length > 0 &&
    v.origin.length <= 500 &&
    Array.isArray(v.rulePath) &&
    v.rulePath.length > 0 &&
    v.rulePath.length <= 64 &&
    v.rulePath.every(step => Number.isInteger(step) && step >= 0 && step < 10000) &&
    typeof v.selectorText === 'string' &&
    v.selectorText.length > 0 &&
    v.selectorText.length <= STYLE_RULE_SELECTOR_MAX &&
    Array.isArray(v.specificity) &&
    v.specificity.length === 3 &&
    v.specificity.every(
      part => Number.isInteger(part) && part >= 0 && part <= STYLE_SPECIFICITY_MAX
    ) &&
    Array.isArray(v.importantProps) &&
    v.importantProps.length <= STYLE_IMPORTANT_PROPS_MAX &&
    v.importantProps.every(
      prop => typeof prop === 'string' && prop.length > 0 && prop.length <= 200
    )
  );
};

/**
 * P3.5 §2：design-rules 消息载荷校验（形状 + 上限，违规整体丢弃）。
 * 与当前选区 elementPath 的一致性由消息处理处核对（迟到消息不污染新选区）。
 */
export const isValidRulesMessage = (value: unknown): value is DesignRulesMessage => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Partial<DesignRulesMessage>;
  return (
    Array.isArray(v.elementPath) &&
    v.elementPath.length <= 64 &&
    v.elementPath.every(step => Number.isInteger(step) && step >= 0 && step < 10000) &&
    Array.isArray(v.rules) &&
    v.rules.length <= STYLE_RULES_MAX &&
    (v.truncated === undefined || typeof v.truncated === 'boolean') &&
    v.rules.every(isValidMatchedRule)
  );
};

export const pathsEqual = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * §6.3 重选对比表：expected 中任一属性与计算样式失配返回 true。
 * color/background-color 是 select 消息的顶层字段（不在 styles 映射里）；
 * 比较口径见 html/style-compare.ts（无可靠口径的组合跳过，宁缺勿误报）。
 */
export function reselectMismatch(
  expected: Map<string, string>,
  selection: DesignSelection
): boolean {
  for (const [property, written] of expected) {
    const computed =
      property === 'color'
        ? selection.color
        : property === 'background-color'
          ? selection.backgroundColor
          : selection.styles?.[property as keyof DesignComputedStyles];
    if (typeof computed !== 'string') continue;
    if (compareCssValues(property, written, computed) === false) return true;
  }
  return false;
}
