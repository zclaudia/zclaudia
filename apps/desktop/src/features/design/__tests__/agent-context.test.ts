import { describe, expect, it } from 'vitest';
import { type AgentContextInput, buildDesignAgentContext } from '../agent-context';

// 真实 SHA-256 样例（"abc" 与 ""），快照与断言确定性
const REV_INDEX = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const REV_ABOUT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const DESIGN_MD_SAMPLE = [
  '# 品牌与设计系统',
  '',
  '## 色彩',
  '| 用途 | Token | 值 |',
  '|---|---|---|',
  '| 主色 | --color-primary | #4f46e5 |',
  '',
  '## 使用规则',
  '按钮一律使用主色，圆角统一 md。',
].join('\n');

const TOKENS_CSS_SAMPLE = [':root {', '  --color-primary: #4f46e5;', '  --radius-md: 8px;', '}'].join('\n');

const FULL_INPUT: AgentContextInput = {
  workingDirectory: '/Users/dev/demo-site',
  projectId: 'proj-42',
  pages: [
    { path: 'design/index.html', docRevision: REV_INDEX, dirty: false },
    { path: 'design/about.html', docRevision: REV_ABOUT, dirty: true },
  ],
  active: {
    path: 'design/index.html',
    docRevision: REV_INDEX,
    dirty: false,
    selection: {
      tagName: 'button',
      elementPath: [0, 2, 1],
      text: '提交表单',
      sourceText: '<button class="cta" type="button">提交表单</button>',
    },
  },
  brand: { designMd: DESIGN_MD_SAMPLE, tokensCss: TOKENS_CSS_SAMPLE },
  assets: {
    referenced: [
      { path: 'design/assets/logo.svg', kind: 'image' },
      { path: 'design/assets/inter.woff2', kind: 'font' },
    ],
    importedRecently: ['design/assets/hero.png'],
  },
  viewport: { preset: 'mobile', width: 390 },
};

const MINIMAL_INPUT: AgentContextInput = {
  pages: [],
  active: null,
  brand: null,
  assets: { referenced: [], importedRecently: [] },
  viewport: { preset: 'fill', width: null },
};

const sectionByTitle = (sections: { title: string }[], title: string) =>
  sections.find(section => section.title === title);

const baseActive = {
  path: 'design/index.html',
  docRevision: REV_INDEX,
  dirty: false,
};

describe('buildDesignAgentContext（P4 §5.1 上下文组装）', () => {
  it('完整样例：generate 快照', () => {
    expect(buildDesignAgentContext(FULL_INPUT, 'generate')).toMatchSnapshot();
  });

  it('完整样例：modify 快照', () => {
    expect(buildDesignAgentContext(FULL_INPUT, 'modify')).toMatchSnapshot();
  });

  it('sections 顺序固定：Workspace / Pages / Selection / Brand rules / Brand tokens / Assets / Viewport', () => {
    const { sections } = buildDesignAgentContext(FULL_INPUT, 'generate');
    expect(sections.map(section => section.title)).toEqual([
      'Workspace',
      'Pages',
      'Selection',
      'Brand rules (design/DESIGN.md)',
      'Brand tokens (design/tokens.css)',
      'Assets',
      'Viewport',
    ]);
  });

  it('Pages 行：disk rev 前 12 位，dirty 页带 unsaved local draft 尾注', () => {
    const { sections } = buildDesignAgentContext(FULL_INPUT, 'generate');
    expect(sectionByTitle(sections, 'Pages')?.lines).toEqual([
      `- design/index.html (disk rev ${REV_INDEX.slice(0, 12)})`,
      `- design/about.html (disk rev ${REV_ABOUT.slice(0, 12)}, unsaved local draft)`,
    ]);
  });

  it('Selection 行：标签、点分路径、文本 JSON、source 片段', () => {
    const { sections } = buildDesignAgentContext(FULL_INPUT, 'generate');
    const lines = sectionByTitle(sections, 'Selection')?.lines ?? [];
    expect(lines[0]).toBe('- Element: <button>');
    expect(lines[1]).toBe('- Element path: 0.2.1');
    expect(lines[2]).toBe('- Text: "提交表单"');
    expect(lines[3]).toBe(
      `- Source: ${JSON.stringify('<button class="cta" type="button">提交表单</button>')}`
    );
  });

  it('Viewport 行：preset 固定有值，width 为 null 时写 auto', () => {
    const { sections } = buildDesignAgentContext(MINIMAL_INPUT, 'generate');
    expect(sectionByTitle(sections, 'Viewport')?.lines).toEqual(['- Preset: fill', '- Width: auto']);
    const full = buildDesignAgentContext(FULL_INPUT, 'generate');
    expect(sectionByTitle(full.sections, 'Viewport')?.lines).toEqual(['- Preset: mobile', '- Width: 390px']);
  });

  it('空 section 整省：无品牌/无选区/无素材/无工作区信息时只剩 Viewport', () => {
    const { sections, prompt } = buildDesignAgentContext(MINIMAL_INPUT, 'generate');
    expect(sections.map(section => section.title)).toEqual(['Viewport']);
    expect(prompt).not.toContain('## Workspace');
    expect(prompt).not.toContain('## Pages');
    expect(prompt).not.toContain('## Selection');
    expect(prompt).not.toContain('## Brand rules');
    expect(prompt).not.toContain('## Brand tokens');
    expect(prompt).not.toContain('## Assets');
  });

  it('brand 单文件 null 只省对应 section；两文件都 null 全省', () => {
    const half = buildDesignAgentContext(
      { ...MINIMAL_INPUT, brand: { designMd: DESIGN_MD_SAMPLE, tokensCss: null } },
      'generate'
    );
    expect(half.sections.map(section => section.title)).toEqual([
      'Brand rules (design/DESIGN.md)',
      'Viewport',
    ]);
    const none = buildDesignAgentContext(
      { ...MINIMAL_INPUT, brand: { designMd: null, tokensCss: null } },
      'generate'
    );
    expect(none.sections.map(section => section.title)).toEqual(['Viewport']);
  });
});

describe('buildDesignAgentContext 截断（§5.1 断言点）', () => {
  it('pages >12：保留 12 行 + `… (+N more)`', () => {
    const pages = Array.from({ length: 15 }, (_, i) => ({
      path: `design/p${i}.html`,
      docRevision: REV_INDEX,
      dirty: i % 2 === 0,
    }));
    const { sections } = buildDesignAgentContext({ ...MINIMAL_INPUT, pages }, 'generate');
    const lines = sectionByTitle(sections, 'Pages')?.lines ?? [];
    expect(lines).toHaveLength(13);
    expect(lines[0]).toBe(`- design/p0.html (disk rev ${REV_INDEX.slice(0, 12)}, unsaved local draft)`);
    expect(lines[1]).toBe(`- design/p1.html (disk rev ${REV_INDEX.slice(0, 12)})`);
    expect(lines[12]).toBe('… (+3 more)');
  });

  it('选区 snippet = sourceText ?? text ≤1000 字符（截断加 …）', () => {
    const { sections } = buildDesignAgentContext(
      {
        ...MINIMAL_INPUT,
        active: {
          ...baseActive,
          selection: { tagName: 'p', elementPath: [0], text: 'x'.repeat(1200), sourceText: 'y'.repeat(1200) },
        },
      },
      'generate'
    );
    const sourceLine = sectionByTitle(sections, 'Selection')?.lines[3] ?? '';
    const snippet = JSON.parse(sourceLine.slice('- Source: '.length)) as string;
    expect(snippet).toHaveLength(1000);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.startsWith('yyy')).toBe(true); // 取的是 sourceText 而非 text
  });

  it('sourceText 缺省时回退 text；文本 JSON ≤300 字符（截断加 …）', () => {
    const { sections } = buildDesignAgentContext(
      {
        ...MINIMAL_INPUT,
        active: {
          ...baseActive,
          selection: { tagName: 'p', elementPath: [0], text: 'x'.repeat(400) },
        },
      },
      'generate'
    );
    const lines = sectionByTitle(sections, 'Selection')?.lines ?? [];
    const text = JSON.parse((lines[2] as string).slice('- Text: '.length)) as string;
    expect(text).toHaveLength(300);
    expect(text.endsWith('…')).toBe(true);
    // Source 片段上限是 1000，400 字符原文未触顶、原样保留（无 …）
    const snippet = JSON.parse((lines[3] as string).slice('- Source: '.length)) as string;
    expect(snippet).toBe('x'.repeat(400));
  });

  it('designMd ≤6000 / tokensCss ≤4000（截断加 `… (truncated)`）', () => {
    const { sections } = buildDesignAgentContext(
      {
        ...MINIMAL_INPUT,
        brand: { designMd: 'a'.repeat(6100), tokensCss: 'b'.repeat(4100) },
      },
      'generate'
    );
    const rulesLine = sectionByTitle(sections, 'Brand rules (design/DESIGN.md)')?.lines[0] ?? '';
    expect(rulesLine).toBe(`${'a'.repeat(6000)}… (truncated)`);
    const tokensLine = sectionByTitle(sections, 'Brand tokens (design/tokens.css)')?.lines[0] ?? '';
    expect(tokensLine).toBe(`${'b'.repeat(4000)}… (truncated)`);
  });

  it('referenced ≤20 / importedRecently ≤10（同 pages 标记法）', () => {
    const { sections } = buildDesignAgentContext(
      {
        ...MINIMAL_INPUT,
        assets: {
          referenced: Array.from({ length: 25 }, (_, i) => ({ path: `design/assets/a${i}.png`, kind: 'image' })),
          importedRecently: Array.from({ length: 12 }, (_, i) => `design/assets/b${i}.woff2`),
        },
      },
      'generate'
    );
    const lines = sectionByTitle(sections, 'Assets')?.lines ?? [];
    expect(lines).toHaveLength(32);
    expect(lines[19]).toBe('- design/assets/a19.png (image)');
    expect(lines[20]).toBe('… (+5 more)');
    expect(lines[21]).toBe('- design/assets/b0.woff2 (imported recently)');
    expect(lines[31]).toBe('… (+2 more)');
  });
});

describe('buildDesignAgentContext prompt（§5.1 结尾任务段）', () => {
  const BRAND_SENTENCE =
    'Follow the brand rules and tokens above when present and keep using local files with relative paths.';

  it('generate：有活动页时按当前页更新 + brand/本地路径收尾', () => {
    const { prompt } = buildDesignAgentContext(FULL_INPUT, 'generate');
    expect(prompt).toContain(
      'Update the current page at design/index.html in this workspace (/Users/dev/demo-site) according to the request; preserve unrelated content.'
    );
    expect(prompt).toContain(
      'Use local files in the design/ folder with relative paths; do not use JavaScript to render the page or depend on CDN/external resources.'
    );
    expect(prompt).toContain('Keep the existing project context for project proj-42.');
    expect(prompt.endsWith(BRAND_SENTENCE)).toBe(true);
  });

  it('generate：非 index 活动页指向当前页，不误写 design/index.html', () => {
    const input: AgentContextInput = {
      ...MINIMAL_INPUT,
      workingDirectory: '/work/site',
      pages: [{ path: 'design/about.html', docRevision: REV_ABOUT, dirty: false }],
      active: { path: 'design/about.html', docRevision: REV_ABOUT, dirty: false, selection: null },
    };
    const { prompt } = buildDesignAgentContext(input, 'generate', { request: 'Make the hero bolder' });
    expect(prompt).toContain(
      'Update the current page at design/about.html in this workspace (/work/site) according to the request; preserve unrelated content.'
    );
    expect(prompt).not.toContain('design/index.html');
    expect(prompt).not.toContain('Modify the selected element');
    expect(prompt).toContain('## Request\n\nMake the hero bolder');
  });

  it('generate：空白工作台无 workingDirectory/projectId 时回退 index 并省略插值', () => {
    const { prompt } = buildDesignAgentContext(MINIMAL_INPUT, 'generate');
    expect(prompt).toContain('Create or update a polished static HTML/CSS page at design/index.html in this workspace.');
    expect(prompt).toContain('Keep the existing project context.');
  });

  it('modify：与既有 handoff 措辞同源（元素/文本/路径）+ brand/本地路径收尾', () => {
    const { prompt } = buildDesignAgentContext(FULL_INPUT, 'modify');
    expect(prompt).toContain(
      `Modify the selected element in design/index.html. Element: <button>; text: ${JSON.stringify(
        '<button class="cta" type="button">提交表单</button>'
      )}; element path: 0.2.1. Please update the HTML file and preserve the surrounding design.`
    );
    expect(prompt.endsWith(BRAND_SENTENCE)).toBe(true);
  });

  it('modify：active/selection 缺失时降级且不抛错', () => {
    const noSelection = buildDesignAgentContext(
      { ...MINIMAL_INPUT, active: { ...baseActive, selection: null } },
      'modify'
    );
    expect(noSelection.prompt).toContain(
      'Modify the selected element in design/index.html. Please update the HTML file and preserve the surrounding design.'
    );
    const noActive = buildDesignAgentContext(MINIMAL_INPUT, 'modify');
    expect(noActive.prompt).toContain(
      'Modify the selected element in the active page. Please update the HTML file and preserve the surrounding design.'
    );
    expect(noActive.prompt.endsWith(BRAND_SENTENCE)).toBe(true);
  });

  it('确定性：同输入两次调用输出相等', () => {
    const a = buildDesignAgentContext(FULL_INPUT, 'generate');
    const b = buildDesignAgentContext(FULL_INPUT, 'generate');
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const m1 = buildDesignAgentContext(FULL_INPUT, 'modify');
    const m2 = buildDesignAgentContext(FULL_INPUT, 'modify');
    expect(m1).toEqual(m2);
  });
});
