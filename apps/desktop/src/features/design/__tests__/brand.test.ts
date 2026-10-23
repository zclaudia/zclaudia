import { describe, expect, it } from 'vitest';
import { type BrandSpec, RADIUS_VALUES, renderDesignMd, renderTokensCss, validateBrandSpec } from '../brand';

const VALID_SPEC: BrandSpec = {
  primary: '#4f46e5',
  secondary: 'rgb(14, 165, 233)',
  background: '#f8fafc',
  text: '#0f172a',
  fontBody: '"Inter", system-ui, sans-serif',
  fontHeading: '"Noto Sans SC", sans-serif',
  spacingUnit: '8px',
  radius: 'md',
  logoPath: '',
  notes: '',
};

const errorsFor = (patch: Partial<BrandSpec>): string[] => validateBrandSpec({ ...VALID_SPEC, ...patch });

describe('validateBrandSpec（P4 §3.2 品牌表单预检）', () => {
  it('合法样例返回空数组', () => {
    expect(validateBrandSpec(VALID_SPEC)).toEqual([]);
  });

  it('四个颜色字段：hex 3/6/8 位、rgb()/rgba()/hsl()、命名色均合法', () => {
    expect(errorsFor({ primary: '#fff' })).toEqual([]);
    expect(errorsFor({ primary: '#4f46e5ff' })).toEqual([]);
    expect(errorsFor({ secondary: 'rgba(10, 20, 30, 0.5)' })).toEqual([]);
    expect(errorsFor({ background: 'hsl(120, 50%, 50%)' })).toEqual([]);
    expect(errorsFor({ text: 'rebeccapurple' })).toEqual([]);
    expect(errorsFor({ primary: 'rgb(255 0 0 / 50%)' })).toEqual([]); // 括号形式含空白/斜杠/百分号
  });

  it('颜色：空值 / 超长 / 非法语法逐项报错', () => {
    expect(errorsFor({ primary: '' })).toEqual(['主色不能为空']);
    expect(errorsFor({ primary: '   ' })).toEqual(['主色不能为空']);
    expect(errorsFor({ secondary: 'a'.repeat(41) })).toEqual(['辅色过长（最多 40 字符）']);
    expect(errorsFor({ background: '#12345' })).toEqual(['背景色不是合法的 CSS 颜色（支持 #hex、rgb()/rgba()/hsl() 或英文命名色）']);
    expect(errorsFor({ background: '#1234567' })).toHaveLength(1);
    expect(errorsFor({ background: 'rgb(255, 0, 0' })).toHaveLength(1);
    expect(errorsFor({ background: 'red blue' })).toHaveLength(1);
    expect(errorsFor({ text: '#GGG' })).toHaveLength(1);
  });

  it('字体：≤120 合法；空值/超长/注入字符报错', () => {
    expect(errorsFor({ fontBody: 'a'.repeat(120) })).toEqual([]);
    expect(errorsFor({ fontHeading: 'a'.repeat(121) })).toEqual(['标题字体过长（最多 120 字符）']);
    expect(errorsFor({ fontBody: '' })).toEqual(['正文字体不能为空']);
    expect(errorsFor({ fontBody: 'Inter; }' })).toEqual([expect.stringContaining('不允许的字符')]);
    expect(errorsFor({ fontBody: '{Inter}' })).toHaveLength(1);
    expect(errorsFor({ fontBody: '<Inter>' })).toHaveLength(1);
    expect(errorsFor({ fontBody: 'Inter\\' })).toHaveLength(1);
    expect(errorsFor({ fontBody: 'url(http://x)' })).toHaveLength(1);
    expect(errorsFor({ fontBody: 'URL(http://x)' })).toHaveLength(1);
    expect(errorsFor({ fontHeading: 'var(--x)' })).toHaveLength(1);
    expect(errorsFor({ fontHeading: 'expression(1)' })).toHaveLength(1);
  });

  it('spacingUnit / radius 只接受字面量联合成员', () => {
    expect(
      validateBrandSpec({ ...VALID_SPEC, spacingUnit: '3px' as BrandSpec['spacingUnit'] })
    ).toEqual(['间距基准只能是 4px 或 8px']);
    expect(
      validateBrandSpec({ ...VALID_SPEC, radius: 'xl' as BrandSpec['radius'] })
    ).toEqual(['圆角档位只能是 none / sm / md / lg']);
  });

  it('logoPath：空串合法；超长 / scheme / // 开头 / 反斜杠 / 控制字符报错', () => {
    expect(errorsFor({ logoPath: '' })).toEqual([]);
    expect(errorsFor({ logoPath: 'design/assets/logo.svg' })).toEqual([]);
    expect(errorsFor({ logoPath: 'a'.repeat(500) })).toEqual([]);
    expect(errorsFor({ logoPath: 'a'.repeat(501) })).toEqual(['Logo 路径过长（最多 500 字符）']);
    expect(errorsFor({ logoPath: 'http://cdn.example.com/logo.png' })).toEqual([
      'Logo 路径必须是工作区相对路径（禁协议前缀与 // 开头）',
    ]);
    expect(errorsFor({ logoPath: 'HTTPS://example.com/l.png' })).toHaveLength(1);
    expect(errorsFor({ logoPath: '//example.com/logo.png' })).toHaveLength(1);
    expect(errorsFor({ logoPath: 'design\\logo.png' })).toEqual(['Logo 路径不能包含反斜杠或控制字符']);
    expect(errorsFor({ logoPath: 'logo\n.png' })).toHaveLength(1);
  });

  it('notes ≤2000', () => {
    expect(errorsFor({ notes: 'a'.repeat(2000) })).toEqual([]);
    expect(errorsFor({ notes: 'a'.repeat(2001) })).toEqual(['使用规则过长（最多 2000 字符）']);
  });

  it('多个字段违规时逐项列出', () => {
    const errors = validateBrandSpec({
      ...VALID_SPEC,
      primary: '',
      fontBody: 'url(x)',
      notes: 'a'.repeat(2001),
    });
    expect(errors).toHaveLength(3);
  });
});

describe('renderDesignMd（P4 §3.1 DESIGN.md 文件形态）', () => {
  it('包含全部令牌与章节结构', () => {
    const md = renderDesignMd({ ...VALID_SPEC, logoPath: 'assets/logo.svg', notes: '按钮一律用主色。' });
    expect(md).toContain('# 品牌与设计系统');
    expect(md).toContain('> 由 ZClaudia 设计工作台生成。');
    expect(md).toContain('## 色彩');
    expect(md).toContain('| 主色 | --color-primary | #4f46e5 |');
    expect(md).toContain('| 辅色 | --color-secondary | rgb(14, 165, 233) |');
    expect(md).toContain('| 背景 | --color-background | #f8fafc |');
    expect(md).toContain('| 文字 | --color-text | #0f172a |');
    expect(md).toContain('## 字体');
    expect(md).toContain('- 正文："Inter", system-ui, sans-serif');
    expect(md).toContain('- 标题："Noto Sans SC", sans-serif');
    expect(md).toContain('## 间距与圆角');
    expect(md).toContain('- 间距基准：8px（--space-unit）');
    expect(md).toContain('- 圆角：md（--radius-md = 8px）');
    expect(md).toContain('## Logo');
    expect(md).toContain('- 引用：assets/logo.svg（相对 design/ 的路径，素材需已在素材库中）');
    expect(md).toContain('## 使用规则');
    expect(md).toContain('按钮一律用主色。');
  });

  it('logoPath 为空写「未指定」；notes 为空写默认文案', () => {
    const md = renderDesignMd(VALID_SPEC);
    expect(md).toContain('- 引用：未指定');
    expect(md).toContain('遵循上表令牌，保持一致性与克制。');
  });

  it('同输入两次渲染输出一致（确定性）', () => {
    expect(renderDesignMd(VALID_SPEC)).toBe(renderDesignMd(VALID_SPEC));
  });
});

describe('renderTokensCss（P4 §3.1 tokens.css 文件形态）', () => {
  it('包含顶部注释、:root 全部键名与 radius 档位注释', () => {
    const css = renderTokensCss(VALID_SPEC);
    expect(css).toContain('/* ZClaudia design tokens — 与 DESIGN.md 对应，可手动编辑 */');
    expect(css).toContain(':root {');
    expect(css).toContain('  --color-primary: #4f46e5;');
    expect(css).toContain('  --color-secondary: rgb(14, 165, 233);');
    expect(css).toContain('  --color-background: #f8fafc;');
    expect(css).toContain('  --color-text: #0f172a;');
    expect(css).toContain('  --font-body: "Inter", system-ui, sans-serif;');
    expect(css).toContain('  --font-heading: "Noto Sans SC", sans-serif;');
    expect(css).toContain('  --space-unit: 8px;');
    expect(css).toContain('  --radius-md: 8px;   /* radius 档位：none=0 / sm=4px / md=8px / lg=16px */');
    expect(css.trimEnd().endsWith('}')).toBe(true);
  });

  it('radius 各档位取 RADIUS_VALUES 对应值', () => {
    expect(renderTokensCss({ ...VALID_SPEC, radius: 'none' })).toContain('--radius-md: 0;');
    expect(renderTokensCss({ ...VALID_SPEC, radius: 'sm' })).toContain('--radius-md: 4px;');
    expect(renderTokensCss({ ...VALID_SPEC, radius: 'lg' })).toContain('--radius-md: 16px;');
    for (const tier of ['none', 'sm', 'md', 'lg'] as const) {
      expect(renderTokensCss({ ...VALID_SPEC, radius: tier })).toContain(`--radius-md: ${RADIUS_VALUES[tier]};`);
    }
  });
});

describe('RADIUS_VALUES', () => {
  it('四档映射 0 / 4px / 8px / 16px', () => {
    expect(RADIUS_VALUES).toEqual({ none: '0', sm: '4px', md: '8px', lg: '16px' });
  });
});
