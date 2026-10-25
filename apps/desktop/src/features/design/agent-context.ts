/**
 * P4.4 Agent 设计上下文纯逻辑（设计文档 §5.1）。
 *
 * buildDesignAgentContext 把「工作区信息 / 页面与修订 / 选区定位与源码片段 /
 * 品牌规则全文 / 素材引用 / 视口」组装为固定顺序的 sections 与最终英文 prompt。
 * 纯函数、无 IO、确定性（同输入必同输出，快照测试锁定）。
 *
 * 结尾任务段与 DesignPanel 既有 generate/handoff 措辞同源，并在末尾追加
 * brand 遵循 + 本地相对路径两点；L19 接线后面板的 generate/handoff 不再
 * 自行拼模板文本。
 */

export interface AgentContextSection {
  title: string;
  lines: string[];
}

export type AgentContextTask = 'generate' | 'modify';

/** 可选请求文本：非空时在 prompt 末尾追加 `## Request` 段（缺省输出保持逐字节不变）。 */
export interface AgentContextOptions {
  request?: string;
}

export interface AgentContextInput {
  workingDirectory?: string;
  projectId?: string;
  /** ≤12，超出截断标记。 */
  pages: { path: string; docRevision: string; dirty: boolean }[];
  active: {
    path: string;
    docRevision: string;
    dirty: boolean;
    selection?: {
      tagName: string;
      elementPath: number[];
      text: string;
      sourceText?: string;
    } | null;
  } | null;
  /** null = 未创建（两个 brand section 都省）；单文件 null 时只省对应 section。 */
  brand: { designMd: string | null; tokensCss: string | null } | null;
  assets: { referenced: { path: string; kind: string }[]; importedRecently: string[] };
  viewport: { preset: string; width: number | null };
}

// 截断上限（§5.1 断言点）
const PAGES_LIMIT = 12;
const SNIPPET_LIMIT = 1000;
const TEXT_JSON_LIMIT = 300;
const DESIGN_MD_LIMIT = 6000;
const TOKENS_CSS_LIMIT = 4000;
const REFERENCED_LIMIT = 20;
const IMPORTED_LIMIT = 10;

/** 超长时截断到 max 字符并以 `…` 结尾（结果总长 ≤ max）。 */
function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** 超长时在 max 字符处截断并追加 `… (truncated)` 标记行尾注释。 */
function truncateWithMarker(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}… (truncated)`;
}

/** Pages 行：`- <path> (disk rev <哈希前 12 位>[, unsaved local draft])`。 */
function pageLine(page: { path: string; docRevision: string; dirty: boolean }): string {
  const rev = page.docRevision.slice(0, 12);
  return `- ${page.path} (disk rev ${rev}${page.dirty ? ', unsaved local draft' : ''})`;
}

/** 同 pages 的 `… (+N more)` 截断标记法。 */
function withMoreMarker<T>(items: T[], limit: number): { kept: T[]; more: number } {
  return { kept: items.slice(0, limit), more: Math.max(0, items.length - limit) };
}

function buildTaskParagraph(input: AgentContextInput, task: AgentContextTask): string {
  const brandSentence =
    'Follow the brand rules and tokens above when present and keep using local files with relative paths.';

  if (task === 'generate') {
    // 与 DesignPanel 既有 generate 模板同源
    return (
      `Create or update a polished static HTML/CSS page at design/index.html in this workspace` +
      `${input.workingDirectory ? ` (${input.workingDirectory})` : ''}. ` +
      'Use local files in the design/ folder with relative paths; do not use JavaScript to render the page or depend on CDN/external resources. ' +
      'Save the page so it appears in the Design panel. ' +
      `Keep the existing project context${input.projectId ? ` for project ${input.projectId}` : ''}. ` +
      brandSentence
    );
  }

  // modify：与既有 handoff 措辞同源；active/selection 缺失时优雅降级
  const active = input.active;
  const selection = active?.selection ?? null;
  let body: string;
  if (active && selection) {
    // 与 DesignPanel handoff 相同的 snippet 口径：sourceText ?? text，≤1000
    const snippet = (selection.sourceText ?? selection.text).slice(0, SNIPPET_LIMIT);
    body =
      `Modify the selected element in ${active.path}. ` +
      `Element: <${selection.tagName}>; text: ${JSON.stringify(snippet)}; ` +
      `element path: ${selection.elementPath.join('.')}. ` +
      'Please update the HTML file and preserve the surrounding design. ';
  } else {
    body =
      `Modify the selected element in ${active?.path ?? 'the active page'}. ` +
      'Please update the HTML file and preserve the surrounding design. ';
  }
  return `${body}${brandSentence}`;
}

/**
 * 构建 Agent 设计上下文。sections 顺序固定：
 * Workspace / Pages / Selection / Brand rules / Brand tokens / Assets / Viewport，
 * 空 section 整省。prompt = sections 的确定性 markdown 拼接 + 结尾任务段。
 */
export function buildDesignAgentContext(
  input: AgentContextInput,
  task: AgentContextTask,
  options?: AgentContextOptions
): { sections: AgentContextSection[]; prompt: string } {
  const sections: AgentContextSection[] = [];

  // Workspace
  const workspaceLines: string[] = [];
  if (input.workingDirectory) workspaceLines.push(`- Working directory: ${input.workingDirectory}`);
  if (input.projectId) workspaceLines.push(`- Project: ${input.projectId}`);
  if (workspaceLines.length > 0) sections.push({ title: 'Workspace', lines: workspaceLines });

  // Pages（≤12，超出 `… (+N more)`）
  if (input.pages.length > 0) {
    const { kept, more } = withMoreMarker(input.pages, PAGES_LIMIT);
    const lines = kept.map(pageLine);
    if (more > 0) lines.push(`… (+${more} more)`);
    sections.push({ title: 'Pages', lines });
  }

  // Selection（active 有 selection 才有）
  const selection = input.active?.selection ?? null;
  if (input.active && selection) {
    const text = truncate(selection.text, TEXT_JSON_LIMIT);
    const snippet = truncate(selection.sourceText ?? selection.text, SNIPPET_LIMIT);
    sections.push({
      title: 'Selection',
      lines: [
        `- Element: <${selection.tagName}>`,
        `- Element path: ${selection.elementPath.join('.')}`,
        `- Text: ${JSON.stringify(text)}`,
        `- Source: ${JSON.stringify(snippet)}`,
      ],
    });
  }

  // Brand rules / Brand tokens（单文件 null 即省对应 section；全文截断加 `… (truncated)`）
  if (input.brand?.designMd != null) {
    sections.push({
      title: 'Brand rules (design/DESIGN.md)',
      lines: truncateWithMarker(input.brand.designMd, DESIGN_MD_LIMIT).split('\n'),
    });
  }
  if (input.brand?.tokensCss != null) {
    sections.push({
      title: 'Brand tokens (design/tokens.css)',
      lines: truncateWithMarker(input.brand.tokensCss, TOKENS_CSS_LIMIT).split('\n'),
    });
  }

  // Assets（两数组皆空则整省；referenced ≤20 / importedRecently ≤10）
  const referenced = input.assets?.referenced ?? [];
  const importedRecently = input.assets?.importedRecently ?? [];
  if (referenced.length > 0 || importedRecently.length > 0) {
    const lines: string[] = [];
    const ref = withMoreMarker(referenced, REFERENCED_LIMIT);
    for (const item of ref.kept) lines.push(`- ${item.path} (${item.kind})`);
    if (ref.more > 0) lines.push(`… (+${ref.more} more)`);
    const imp = withMoreMarker(importedRecently, IMPORTED_LIMIT);
    for (const path of imp.kept) lines.push(`- ${path} (imported recently)`);
    if (imp.more > 0) lines.push(`… (+${imp.more} more)`);
    sections.push({ title: 'Assets', lines });
  }

  // Viewport（preset 恒有，section 不为空）
  const width = input.viewport?.width;
  sections.push({
    title: 'Viewport',
    lines: [`- Preset: ${input.viewport?.preset ?? 'fill'}`, `- Width: ${width == null ? 'auto' : `${width}px`}`],
  });

  const blocks = sections.map(section => ['## ' + section.title, ...section.lines].join('\n'));
  const request = options?.request?.trim();
  const prompt = [
    ...blocks,
    buildTaskParagraph(input, task),
    ...(request ? ['## Request', request] : []),
  ].join('\n\n');
  return { sections, prompt };
}
