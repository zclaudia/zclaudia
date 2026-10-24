# P3.5 CSS 来源编辑 — 实现设计

日期：2026-10-24。状态：设计定稿（用户已确认三项决策），执行协议已定（§7.4，luna @ GLM-5.3-Flash 逐卡 + 主代理验收）；第一批未开始。上游计划：[分阶段实施计划](2026-10-23-design-workbench-implementation-plan.md) 的 P3.5 条目；P3.1–P3.4 基线见 [P3 实现设计](2026-10-23-design-workbench-p3-implementation.md)。

本批分两批交付（用户 2026-10-24 确认）：

- **第一批**：生效规则与覆盖原因展示 + HTML 文档内 `<style>` 块的受控声明写回。零服务端改动（`<style>` 块属于 HTML 文档草稿，复用 P1 全套事务/撤销/保存/冲突/快照链路）。
- **第二批**：外部本地 `.css` 文件的声明写回（轻量 per-file CSS 草稿 + 服务端 `.css` 读写扩展 + 预览草稿内联）。

明确排除（第一版边界）：

- **写回仅限本地来源**：入口 HTML 内 `<style>` 块（第一批）与工作区本地 `.css` 文件（第二批）。远程样式表在预览构建时已移除，天然不出现；`@import` 嵌套文件在两批中均只读展示并标注原因。
- **只做声明级修改**：改值 / 删除声明 / 在规则内新增声明。不做整条规则增删、选择器编辑、CSS 重排或美化；无关字节逐字保持（P1.2 口径）。
- **内联 style 属性不经来源区编辑**：沿用 P1.8/P3.1 的 23 属性 inline 面板；来源区对 inline 声明仅展示与提示入口，不重复第二条编辑路径。
- **CSSOM 与源码无法对齐的规则一律只读**并显示原因，绝不猜测定位（对齐判定见 §3）。
- **`.css` 不进入标签页与多页控制器**（用户决策）：CSS 保持「依赖不是页」的现状，草稿模型见 §6。

## 0. 已定决策

1. **用户 2026-10-24 三项确认**：分两批交付；编辑入口为独立「样式来源」区（现有 23 属性 inline 面板完全不动）；外部 `.css` 采用轻量 per-file 草稿。
2. **匹配仲裁交给浏览器**：在预览 iframe 内枚举 `document.styleSheets` 并对选择器组逐个 `el.matches()`（浏览器做匹配，宿主不重新实现选择器引擎）；特异性由桥内小函数计算。宿主只做「身份对齐」。
3. **源码侧是唯一真源**：预览构建会把 `url()` 改写为 data URL（`preview.ts:154-156`），CSSOM 的 `cssText` 与源码不同——**CSSOM 文本不上屏、不写回**。展示与写回都基于宿主侧 postcss 解析的源码文本。
4. **postcss 为解析器**：desktop 既有直接依赖（`apps/desktop/package.json:80`，tailwind 同款 8.5.15，零新增）。选择器匹配不需要解析器（浏览器做）；postcss 只用于宿主侧规则/声明偏移。
5. **来源标记为预览专用属性** `data-zclaudia-style-origin`，只存在于预览 DOM，不写入作品文件（P1.3「预览专用标记不写入作品」口径）。
6. **生效值真值锚点不变**：计算样式仍来自 select 消息（21 键，`BRIDGE_STYLE_KEYS`）。「生效中」徽标按级联序（inline 属性 → 特异性 → 源码后写）+ 计算值等值判定，仅在 21 键上展示；`!important` 只作徽标展示，**不做完整级联模拟**（层叠层/origin 反转等复杂情形不声称覆盖，计算值对比仍是最终口径）。

## 1. 预览构建：来源标记

`preview.ts` 改动（C1）：

- link → style 内联处（`preview.ts:149-151`）：创建 `<style>` 时即 `style.setAttribute('data-zclaudia-style-origin', cssPath)`（工作区相对路径，即现有 `cssPath` 变量）。
- 既有「全部 style 改写 url()」循环（`preview.ts:154`）之前，先给**入口自有 `<style>` 块**按文档序赋 `data-zclaudia-style-origin="@inline/<n>"`（n 从 0 起；link 替换发生在前，无标记的 style 即入口自有块）。
- link→style 与 url() 改写逻辑抽公共函数，`interactive.ts`（运行模式复制了同一内联逻辑，`interactive.ts:96-114`）同步打标——运行模式本批不消费（运行模式隐藏编辑区），仅为两构建器行为一致，避免后续重复勘察。
- `deck.ts:filterSlideInPreviewHtml` 只移除 script，来源属性自然保留；缩略图/播放/渲染导出不受影响（多出的 data 属性不参与渲染）。
- CSP 无需变化（`preview.ts:174` 已含 `style-src 'unsafe-inline' data:`；读取 CSSOM 与 `matches()` 不受 CSP 限制）。

## 2. 桥接扩展：生效规则消息

新增两条消息（C1，`preview.ts` 桥内实现，nonce 与既有校验链路不变）：

- 宿主 → iframe：`zclaudia:design-rules-request`，载荷 `{ elementPath: number[] }`（复用 `select-path` 的路径回走代码）。
- iframe → 宿主：`zclaudia:design-rules`，载荷 `{ elementPath, rules: MatchedRule[], truncated?: boolean }`。

```ts
interface MatchedRule {
  origin: string; // data-zclaudia-style-origin 原值（'@inline/2' 或 'design/css/main.css'）
  rulePath: number[]; // 顶层规则索引 + 分组内索引（@media 等嵌套），文档序
  selectorText: string; // 命中的那个选择器原文（选择器组逐个 el.matches 取命中项，≤300）
  specificity: [number, number, number];
  importantProps: string[]; // 该规则内 !important 的属性名（徽标用）
}
```

桥内行为：遍历 `document.styleSheets` → 逐 sheet（`ownerNode` 读 `data-zclaudia-style-origin`，缺失则跳过——防御）→ 递归展开分组规则（`CSSMediaRule` 等）→ 对每条 `CSSStyleRule.selectorText` 按逗号拆分（括号/引号感知）逐个 `el.matches()` → 命中即上报一条（特异性按命中选择器计算，`:not()`/`:is()` 参数递归计入，伪元素按元素位计）。上限：规则 ≤200 条（超出置 `truncated: true`）、specificity 数值 ≤9999、`importantProps` ≤64 项。

宿主校验（DesignPanel 侧 `isValidRulesMessage`，风格同 `isValidSelection`）：`event.source`/channel 既有防线之外，校验 `elementPath` 与**当前 selection** 一致——不一致直接丢弃（迟到消息不污染新选区，口径同 `controller.ts:492-499`）；载荷形状（rules 数组每项字段类型与上限）违规整体丢弃。失败/超限不上屏即静默丢弃并清空规则区（与 select-failed 口径一致：不告警、不清选区）。

## 3. 宿主侧：源码对齐与规则模型（`css-source.ts`，C2 纯模块）

```ts
export interface CssDeclarationRow {
  property: string;
  value: string;
  important: boolean;
  winning: boolean | null; // 仅 21 键属性有值（级联序+计算值等值判定）；其余 null
  editable: boolean;
}
export interface CssRuleRow {
  origin: string;
  selectorText: string;
  rulePath: number[];
  specificity: [number, number, number];
  readOnly: null | {
    reason: 'parse-error' | 'align-mismatch' | 'external-css-readonly' | 'oversize';
  };
  declarations: CssDeclarationRow[]; // 来自源码解析，非 CSSOM
}
export function buildStyleRules(input: {
  htmlSource: string;
  matched: MatchedRule[];
  computed: DesignComputedStyles; // select 消息 21 键
  inlineStyle: string | null; // 仅展示置顶提示，不编辑
}): CssRuleRow[];
```

- **入口 `<style>` 块枚举**：parse5（既有 `html/parse.ts` 基建）枚举 `<style>` 元素（文档序）→ `{ ordinal, text, textStartOffset }`（textStartOffset = 文本子节点 sourceCodeLocation 起点；单块 >1 MiB → 该块规则全部 `oversize` 只读）。
- **postcss 对齐**：对块文本 `postcss.parse`（`{ map: false }`）→ 按文档序构建与 `rulePath` 同构的嵌套索引树。每条 MatchedRule：`origin` 以 `@inline/` 前缀取 ordinal → 按 `rulePath` 取规则 → `selectorText` 归一比对（空白折叠、前后空白去除；**严格相等**，不做模糊/邻近匹配）→ 命中则产出声明行（postcss Declaration 节点的源码偏移随行携带，供 §4 patch 使用）；任一步失败（parse 异常 / 索引越界 / 指纹不符）→ 该规则 `readOnly` 并给 reason。浏览器丢弃非法规则导致的索引漂移由此兜住：**对不上即只读，不猜**。
- **非 `@inline` origin**（外部 `.css` 文件路径）：第一批一律 `external-css-readonly`（UI 提示「外部样式表写回在第二批开放」）；第二批放开（§6）。
- **winning 判定**：同一属性在全部匹配规则 + inline 声明中按（inline 属性优先 → 特异性 → 源码后写）排序，取末位；其值与 computed 等值判定复用从 `DesignPanel.reselectMismatch` 抽出的比较器（颜色等价 / font-weight 归一 / px 数值 / 关键字大小写，含「无可靠口径跳过」集合）。判不出的属性 `winning: null`，不显示徽标。

## 4. 写回引擎：HTML 事务新 op（C3）

`DesignEditOperation`（`types.ts:95-113`）新增：

```ts
{ kind: 'styleBlock';
  styleOrdinal: number;      // 入口 <style> 块序号
  rulePath: number[];        // §3 对齐所得
  property: string;          // /^-?[A-Za-z][A-Za-z0-9-]*$/ 且 ≤64
  value: string | null;      // null = 删除声明
  create: boolean }          // true 且属性不存在 = 新增声明
```

- **`edit-engine` 扩展**：定位 ordinal 的 `<style>` 元素（parse5）→ 块文本经同一 postcss 引擎取目标声明偏移 → 以 `textStartOffset + 块内偏移` 换算为全文绝对 splice：
  - 改值：仅替换 value token 范围（声明分隔符与空白原样保留）；
  - 删除（`value: null`）：连同该声明及其一侧分隔符/空白整体移除（按 postcss raws 判定，不留孤立分号）；
  - 新增（`create: true`，属性不存在才生效）：在规则闭合 `}` 前按块缩进插入 `prop: value;`（缩进取规则内既有声明的 rawBefore 样式，空规则用规则前缩进 + 1 级）。
  - 多 op 事务沿用**高偏移先应用**（`edit-engine.ts:214-225` 既有）；与 `structure` 混排仍被独占校验拒绝（`edit-engine.ts:501-517` 既有）。对齐失败（指纹不符等）抛既有 `ELEMENT_NOT_FOUND` 语义的新错误码 `STYLE_SOURCE_NOT_FOUND`，事务整体拒绝、不部分应用。
- **值黑名单 `safeSourceCssValue`**（`html/values.ts` 新函数，替代白名单校验——来源编辑的价值正在 23 属性之外的属性）：拒绝 `;` `{` `}`、注释 `/*`、`url(`/`URL(`、`expression(`、`@`、控制字符、>500 字符；属性名同上正则。删除操作不受值校验限制。
- **mergeKey/label**：`style:${pathKey}:${styleOrdinal}:${rulePath.join('.')}:${property}`（连续改值合并撤销）；label `Edit style source ${pathKey}`。`controller.apply` 走既有记录（`controller.ts:307-346`），撤销/保存/冲突/快照全部继承。
- **应用后刷新**：走既有 reselect 回路重选元素（计算样式对比逻辑不变）；宿主随后对新选区重发 rules-request 刷新规则区。

## 5. UI：样式来源区（C4）

- 新组件 `components/StyleSourcePanel.tsx`，挂于 SelectionEditor 下方（同卡片视觉，标题「样式来源」）。数据流：selection 到达 → DesignPanel 发 `rules-request` → `design-rules` 到达且校验通过 → `css-source.buildStyleRules` → 渲染。预览重建（改值后）期间规则区显示 loading，重建完成后自动刷新。
- 展示：按预览 DOM 序分组规则卡（选择器等宽字体、来源徽标——`@inline/n` 显示「页面内样式块 #n」、`.css` 路径显示相对路径、`!important` 徽标、只读原因文案）；声明行（属性名、源码值截断、生效中徽标、操作：改值输入框 / 删除 / 新增声明表单）。inline 声明置顶仅提示「内联样式请在上方属性面板编辑」。
- 编辑动作 → `controller.apply([{kind:'styleBlock', …}])`（与 `handleApply` 同通道：busy 防抖、错误提示、reselect 期望全部沿用）。脏点/保存按钮沿用页面级（`<style>` 块修改即 HTML 文档草稿脏）。
- 空态：无匹配规则 → 「该元素没有匹配的样式表规则；内联样式可在上方属性面板编辑」。
- 运行模式：随编辑区整体隐藏（P5 既有 `runMode` 门控，无新增逻辑）。

## 6. 第二批：外部 `.css` 写回

- **服务端（C5）**：`readDocument`/`writeDocument` 的扩展名白名单从 `/\.html?$/i` 增补 `.css`（`design-service.ts:312-313/341-342`）——同一 `safeWriteFile` 链路（SHA-256 修订校验、写前备份、原子替换；上限复用 `MAX_SOURCE_BYTES` 2 MiB）。`GET /design/files` 清单仍只列 HTML（CSS 经来源区按路径打开）；`GET /design/asset` 不变（预览仍取磁盘版，草稿在客户端内联替换）。错误码与信封零新增。
- **桌面草稿（C6 `css-drafts.ts`）**：按 workspace identity + css 路径的进程内草稿表（模式对齐 `workspace/storage.ts`）：`{ source, baseRevision, dirty, history（有界，尺寸同 HISTORY_OPTIONS）, cssDraftEpoch }`。`applyCssEdit(path, edit)` 复用 §3/§4 抽出的 `patchCssText(blockText, edit)` 纯函数（HTML `<style>` 块与独立 CSS 文件共用同一偏移引擎，仅宿主不同）。
- **预览草稿内联**：DesignPanel 的 `loadAsset` 包装——路径存在草稿时返回草稿文本（utf8 → base64，绕过 asset 请求）；预览缓存键在 `草稿修订:资源纪元:模式` 后追加 `:cssDraftEpoch`（每次 CSS 草稿 apply 自增）→ 未保存样式改动即时可见。保存后磁盘 mtime 变化经既有 deps 轮询 → `assetEpoch` 自增（不新增机制）。
- **保存与冲突**：样式来源区显式「保存样式」→ `writeDocument(.css, expectedRevision=baseRevision)`；409 `REVISION_CONFLICT` → 来源区横幅「样式文件已被外部修改」+「保留草稿」/「重新载入」两动作（文案对齐 HTML 页冲突口径）。保存成功清 dirty、刷新 baseRevision。
- **导出边界（诚实声明）**：ZIP 导出（disk/draft 两模式）**不包含未保存的 CSS 草稿**，导出对话框在存在 CSS 脏草稿时明示「导出不包含未保存的样式修改，请先保存样式」。不做 export-service 的草稿注入（如后续需要另立小批次）。
- **快照**：不动——P1 快照捕获的是磁盘 CSS（既有），CSS 草稿与 HTML 草稿同口径（不进快照）。

## 7. 测试与任务卡

命令（各卡钉死）：

```sh
# desktop（C1–C4、C6）
fnm exec --using 22.20.0 pnpm --filter @zclaudia/desktop exec vitest run --config vitest.ui.config.ts src/features/design
fnm exec --using 22.20.0 pnpm --filter @zclaudia/desktop exec tsc --noEmit
fnm exec --using 22.20.0 pnpm --filter @zclaudia/desktop exec eslint src/features/design
# server（C5）
fnm exec --using 22.20.0 pnpm --filter @zclaudia/server exec vitest run src/application/design/__tests__ src/interfaces/http/__tests__/design.test.ts
fnm exec --using 22.20.0 pnpm --filter @zclaudia/server exec tsc --noEmit
```

基线：desktop design 720 通过（42 文件）；server design 267 通过 + 1 skipped；双端 tsc 0 错；desktop eslint 0 error / 37 warning 基线。注：仓库自 `~/SourceCode/zclaudia` 迁至 `~/SourceCode/zclaudia-repositories/zclaudia`，旧文档中的 `bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh …` 形式已不可用，统一 `fnm exec --using 22.20.0`（`.node-version` 锁定）。

任务卡（串行派发，一次一卡；luna 实现、主代理逐卡验收，模式同 P6/P7）：

- **T0（主代理，派发前）**：本设计文档 + `types.ts` 契约（`DesignStyleOrigin`/`MatchedRule`/`DesignRulesMessage` 类型与 `styleBlock` op 类型 + 常量：上限集合）。除此之外无共享契约文件改动。
- **C1 预览与桥接**：`preview.ts`（来源标记 + 规则枚举消息 + 抽公共内联函数）+ `interactive.ts`（同步打标）+ `DesignPanel` 校验与 rules-request 发送。测试：标记正确性（link/自有块/多块序号）、桥内选择器组命中与特异性、上限截断、宿主校验（迟到 elementPath 丢弃/形状违规丢弃）。禁改：`css-source.ts`、`edit-engine.ts`、服务端。
- **C2 源码对齐纯模块**：`css-source.ts` + `__tests__/css-source.test.ts`。测试：对齐命中矩阵（嵌套 @media 索引/多 `@inline` 块/指纹不符/parse 失败/超限只读）、winning 判定（颜色等价/font-weight/px/跳过集合）、外部 origin 第一批只读。禁改：preview/桥接、edit-engine、组件、服务端。
- **C3 事务 op**：`types.ts` 落 op（T0 已定契约，**union 并入在本卡**——T0 勘察发现 DesignPanel mergeKey 三元链末支假定 structure，先加变体会破坏 tsc，故并入联合须与 DesignPanel 的 mergeKey/needsReselect 两处接线同卡落地）+ `edit-engine.ts` 实现 + `html/values.ts` `safeSourceCssValue`。测试：改值/删除/新增的逐字节保持（无关空白、相邻声明、末声明分号）、多 op 高偏移先应用、与 structure 混排拒绝、对齐失败整体拒绝不部分应用、值黑名单矩阵。禁改：组件（DesignPanel 的 mergeKey/needsReselect 两处接线除外）、服务端、preview。
- **C4 面板与接线**：`StyleSourcePanel.tsx` + DesignPanel/SelectionEditor 接线 + 用例（分组渲染/徽标/只读原因/编辑经 controller.apply/撤销与脏点/空态/运行模式隐藏/reselect 后刷新）。禁改：契约与引擎行为（props 微调记录）。
- **C5 服务端 .css 读写**（第二批）：`design-service.ts` 白名单 + `design.test.ts` 追加。测试：.css 读写往返、修订冲突 409、越界路径/超限/HTML 之外其他扩展仍拒。禁改：桌面端。
- **C6 CSS 草稿与预览内联**（第二批）：`css-drafts.ts` + `patchCssText` 抽取（自 C2/C3 落点，签名微调须记录）+ DesignPanel loadAsset 包装与缓存键 + 保存/冲突 UI + 用例。禁改：服务端、edit-engine 事务语义。
- **C7 文档与勾选**（第二批）：`docs/design-workbench.md` P3.5 小节、主计划 P3.5 勾选与基线段更新。

波次：第一批 T0 → (C1 ∥ C2) → C3 → C4；第二批 C5 → C6 → C7。

### 7.4 执行协议（sub-agent + GLM-5.3-Flash）

**分工**：主代理（GLM-5.3）负责 T0 契约预落、逐卡验收（代码审查 + 门禁复跑 + §11 记录）与终验收；每张 C 卡由 luna 子代理（`account:bigmodel-individual-coding-plan/GLM-5.3-Flash`，thoughtLevel max，`.zcode/agents/luna.md`）实现。串行派发、一次一卡（C1 与 C2 文件集不相交，可并行两张；其余严格串行——C3 依赖 C2 的对齐产物、C4 依赖 C1–C3 全部、C6 依赖 C5）。

**派卡模板**：卡面 = 设计文档对应小节全文 + 文件清单 + 钉死命令 + 禁改边界。luna 自行 Read 本档与相关既有文件；返回 ≤30 行报告（status / 文件 / 测试计数 / 契约偏差）。文案语言规则：design 面板用户可见文案为英文（2026-10-24 翻译后口径，luna.md 已同步），测试用例标题可保留中文。

**逐卡验收（主代理）**：① 范围核对（git status 无越权文件）；② 契约审查（签名/错误码/边界与本文档一致，契约偏差要么打回要么主代理修正并记录）；③ 门禁复跑（卡面命令 + 严格退出码）；④ 基线保护：desktop/server 通过数不低于前卡、tsc 0 错、eslint 0 error 且新增 warning 逐条记录；⑤ 通过后放行下一卡，§11 追加验收记录。

**失败处理**：luna 报 blocked 或偏差不可接受 → 主代理自行修正（记「主代理修正」）或携批注重派同一卡；同一卡最多重派一次，再失败升级给用户。测试基线失败（与本卡无关的既有失败）按 luna 报告的基线口径核对，不擅自修卡外文件。

**检查点**：第一批 C4 验收后做小终验（全门禁 + 手工冒烟清单入 §10）；第二批 C7 后做终验收（全门禁 + `docs/design-workbench.md`/主计划勾选 + 本档状态行更新为已实现）。每张卡验收通过即 git commit（`feat(design): ...`，消息注明卡号），不攒批。

## 8. 验收对照（上游 P3.5 条目）

| 上游措辞                                                     | 覆盖                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 先显示生效规则和覆盖原因                                     | §2 浏览器匹配 + §3 源码对齐 + §5 规则区（生效徽标/被覆盖展示/只读原因） |
| 再支持受控的本地 CSS 声明修改                                | §4 声明级 op（第一批）；§6 外部文件（第二批）                           |
| 外部样式表写回依赖 CSS 源码位置、P1 多文件恢复和 P2 资源刷新 | postcss 源码偏移；快照含 CSS 既有；deps/assetEpoch 既有链路复用         |
| 无唯一来源时保留显式 inline override 方案                    | 23 属性 inline 面板不动；对齐失败/外部来源只读并说明                    |
| 不能可靠处理的组合明确拒绝，不破坏原布局源码                 | 指纹不符/parse 失败/超限/@import 只读；逐字节无关保持；事务整体拒绝     |

## 9. 架构约束对照

- 项目文件是作品来源：写回直接修改 HTML 文档草稿 / CSS 文件，无第二作品库 ✓。
- 所有文件访问由宿主处理：规则枚举在 iframe 内自读 CSSOM（无文件访问），写回走既有事务/端点 ✓。
- 按能力拆模块：preview 标记 / 桥接消息 / css-source 对齐 / edit-engine op / StyleSourcePanel / css-drafts 各自独立文件 ✓。
- 复用现有宿主能力：postcss 既有依赖；deps 轮询、safe-write、撤销历史、reselect 回路全部复用，零新机制 ✓。
- 编辑能力显式声明：只读原因四类明示；CSSOM/源码不一致不猜测 ✓。

## 10. 待补验证（M2 门槛）

真实 Agent + macOS Tauri 冒烟（与 P3 既有待补合并执行）：选中卡片查看规则来源 → 在 `<style>` 块改值/删声明 → 撤销 → 保存重载一致；第二批再加外部 `.css` 修改 → 预览即时刷新 → 保存 → 冲突场景（外部改文件后保存被拒）。本批以自动化测试为准并记录待办。

## 11. 验收记录

### T0（2026-10-24，主代理）

- `types.ts` 落契约：`DesignStyleOrigin`/`DesignMatchedRule`/`DesignRulesMessage`/`DesignStyleBlockOperation`（暂独立接口，C3 并入 `DesignEditOperation`，原因见 C3 卡）+ 错误码 `STYLE_SOURCE_NOT_FOUND` + 上限常量（`STYLE_RULES_MAX` 等 8 项）。命名取文件既有 `Design` 前缀（文档 §2 草图名 `MatchedRule` → `DesignMatchedRule`）。
- 抽取共享比较器 `html/style-compare.ts`（`compareCssValues` 三态 + `colorsEquivalent`/`fontWeightValue`），DesignPanel `reselectMismatch` 改为委托（verify 回路的 `colorsEquivalent` 改为 import）——保证 C1∥C2 并行时文件集不相交（css-source 与 reselect 共用同一比较口径）。新增 `__tests__/style-compare.test.ts` 3 用例。
- 门禁：desktop design 723 通过（720 基线 + 3）；tsc 0 错；eslint 0 error / 37 warning（基线不变）。

（待续：每卡 luna 报告要点、主代理审查与修正、门禁计数、commit 哈希；第一批 C4 后小终验、第二批 C7 后终验收。）
