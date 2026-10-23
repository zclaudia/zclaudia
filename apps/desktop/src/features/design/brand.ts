/**
 * P4.2 品牌与设计系统纯逻辑（设计文档 §3.1/§3.2）。
 *
 * validateBrandSpec 返回违规字段中文错误列表（空数组 = 合法）；
 * renderDesignMd / renderTokensCss 把 BrandSpec 渲染为 design/DESIGN.md 与
 * design/tokens.css 的文件形态（服务端只存字节）。纯函数、无 IO、无依赖。
 *
 * 校验口径说明：颜色/字体/logoPath 规则与 html/values.ts 的 safeColor、
 * safeFontFamily、safeAttrValue src 同口径，但此处独立实现，不 import
 * values.ts，避免编辑引擎模块耦合进品牌面板。
 */

export interface BrandSpec {
  /** CSS 颜色语法，trim 后非空 ≤40 字符。 */
  primary: string;
  secondary: string;
  background: string;
  text: string;
  /** ≤120，禁 ;{}<>\\ url( var( expression(（大小写不敏感），同 P3 font-family 口径。 */
  fontBody: string;
  fontHeading: string;
  spacingUnit: '4px' | '8px';
  radius: 'none' | 'sm' | 'md' | 'lg';
  /** 空串合法；非空时 1–500 字符、禁 scheme 与 `//` 开头、禁反斜杠/控制字符。 */
  logoPath: string;
  /** ≤2000。 */
  notes: string;
}

/** radius 档位 → CSS 圆角值（tokens.css 的 --radius-md 取此值）。 */
export const RADIUS_VALUES: Record<BrandSpec['radius'], string> = {
  none: '0',
  sm: '4px',
  md: '8px',
  lg: '16px',
};

const SPACING_UNITS: readonly string[] = ['4px', '8px'];
const RADIUS_KEYS: readonly string[] = ['none', 'sm', 'md', 'lg'];

// `#rgb` / `#rrggbb` / `#rrggbbaa`
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// rgb()/rgba()/hsl()/hsla() 括号形式（内容限数字、百分号、空白、逗号、加负号、斜杠）
const FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla)\([\d.%\s,+/-]+\)$/i;
// CSS 命名色（宽进严出：3–32 个字母）
const NAMED_COLOR = /^[a-zA-Z]{3,32}$/;

/** C0 控制字符（U+0000–U+001F）与 DEL。 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** 同 html/values.ts safeColor 的语法口径，长度上限 40、命名色放宽为 3–32 字母。 */
function isValidColor(value: string): boolean {
  return HEX_COLOR.test(value) || FUNC_COLOR.test(value) || NAMED_COLOR.test(value);
}

/** 同 html/values.ts safeFontFamily 的注入字符口径。 */
function hasFontInjection(value: string): boolean {
  return /[;{}<>\\]|url\s*\(|var\s*\(|expression/i.test(value);
}

// scheme 形如 `x:`（含协议相对之外的绝对 URL），`//` 开头同为非工作区相对路径
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

const COLOR_FIELDS: { key: 'primary' | 'secondary' | 'background' | 'text'; label: string }[] = [
  { key: 'primary', label: '主色' },
  { key: 'secondary', label: '辅色' },
  { key: 'background', label: '背景色' },
  { key: 'text', label: '文字色' },
];

const FONT_FIELDS: { key: 'fontBody' | 'fontHeading'; label: string }[] = [
  { key: 'fontBody', label: '正文字体' },
  { key: 'fontHeading', label: '标题字体' },
];

/**
 * 校验 BrandSpec。返回违规字段的中文错误列表（逐字段一条），空数组 = 合法。
 */
export function validateBrandSpec(spec: BrandSpec): string[] {
  const errors: string[] = [];

  for (const { key, label } of COLOR_FIELDS) {
    const value = (spec[key] ?? '').trim();
    if (!value) {
      errors.push(`${label}不能为空`);
    } else if (value.length > 40) {
      errors.push(`${label}过长（最多 40 字符）`);
    } else if (!isValidColor(value)) {
      errors.push(`${label}不是合法的 CSS 颜色（支持 #hex、rgb()/rgba()/hsl() 或英文命名色）`);
    }
  }

  for (const { key, label } of FONT_FIELDS) {
    const value = (spec[key] ?? '').trim();
    if (!value) {
      errors.push(`${label}不能为空`);
    } else if (value.length > 120) {
      errors.push(`${label}过长（最多 120 字符）`);
    } else if (hasFontInjection(value)) {
      errors.push(`${label}包含不允许的字符（禁 ; { } < > \\ 与 url( / var( / expression(）`);
    }
  }

  if (!SPACING_UNITS.includes(spec.spacingUnit)) {
    errors.push('间距基准只能是 4px 或 8px');
  }
  if (!RADIUS_KEYS.includes(spec.radius)) {
    errors.push('圆角档位只能是 none / sm / md / lg');
  }

  const logo = spec.logoPath ?? '';
  if (logo) {
    if (logo.length > 500) {
      errors.push('Logo 路径过长（最多 500 字符）');
    } else {
      if (URL_SCHEME.test(logo) || logo.startsWith('//')) {
        errors.push('Logo 路径必须是工作区相对路径（禁协议前缀与 // 开头）');
      }
      if (logo.includes('\\') || hasControlChars(logo)) {
        errors.push('Logo 路径不能包含反斜杠或控制字符');
      }
    }
  }

  if ((spec.notes ?? '').length > 2000) {
    errors.push('使用规则过长（最多 2000 字符）');
  }

  return errors;
}

const NOTES_DEFAULT = '遵循上表令牌，保持一致性与克制。';

const DESIGN_MD_HEADER = `# 品牌与设计系统

> 由 ZClaudia 设计工作台生成。可直接编辑本文件与 tokens.css；Agent 修改页面时会读取两者。
`;

/**
 * 渲染 design/DESIGN.md（文件形态见设计文档 §3.1）。
 * 颜色/字体/logo/notes 均取 trim 后的值（与 validateBrandSpec 的口径一致）。
 */
export function renderDesignMd(spec: BrandSpec): string {
  const lines: string[] = [DESIGN_MD_HEADER];
  lines.push(
    '## 色彩',
    '| 用途 | Token | 值 |',
    '|---|---|---|',
    `| 主色 | --color-primary | ${spec.primary.trim()} |`,
    `| 辅色 | --color-secondary | ${spec.secondary.trim()} |`,
    `| 背景 | --color-background | ${spec.background.trim()} |`,
    `| 文字 | --color-text | ${spec.text.trim()} |`,
    '',
    '## 字体',
    `- 正文：${spec.fontBody.trim()}`,
    `- 标题：${spec.fontHeading.trim()}`,
    '',
    '## 间距与圆角',
    `- 间距基准：${spec.spacingUnit}（--space-unit）`,
    `- 圆角：${spec.radius}（--radius-md = ${RADIUS_VALUES[spec.radius]}）`,
    ''
  );
  const logo = spec.logoPath.trim();
  if (logo) {
    lines.push('## Logo', `- 引用：${logo}（相对 design/ 的路径，素材需已在素材库中）`, '');
  } else {
    lines.push('## Logo', '- 引用：未指定', '');
  }
  const notes = spec.notes.trim();
  lines.push('## 使用规则', notes || NOTES_DEFAULT, '');
  return `${lines.join('\n')}\n`;
}

/**
 * 渲染 design/tokens.css（文件形态见设计文档 §3.1；radius 值取 RADIUS_VALUES）。
 */
export function renderTokensCss(spec: BrandSpec): string {
  const lines = [
    '/* ZClaudia design tokens — 与 DESIGN.md 对应，可手动编辑 */',
    ':root {',
    `  --color-primary: ${spec.primary.trim()};`,
    `  --color-secondary: ${spec.secondary.trim()};`,
    `  --color-background: ${spec.background.trim()};`,
    `  --color-text: ${spec.text.trim()};`,
    `  --font-body: ${spec.fontBody.trim()};`,
    `  --font-heading: ${spec.fontHeading.trim()};`,
    `  --space-unit: ${spec.spacingUnit};`,
    `  --radius-md: ${RADIUS_VALUES[spec.radius]};   /* radius 档位：none=0 / sm=4px / md=8px / lg=16px */`,
    '}',
  ];
  return `${lines.join('\n')}\n`;
}
