# 内置设计工作台原型

设计工作台沿用 ZClaudia 当前会话、Agent 和工作目录，以磁盘上的 HTML 文件作为作品来源。
这是参照 Open Design 的“文件 → 预览 → 元素编辑 → 写回源码”边界实现的小型模块；不启动 Open Design daemon，也不引入第二套聊天或项目数据库。

后续能力与验收顺序见 [分阶段实施计划](plans/2026-10-23-design-workbench-implementation-plan.md)。

## 使用

1. 打开一个有工作目录的会话，在右侧工具区或工具添加菜单选择 **设计**。
2. 顶栏一行承载高频操作：页面标签（脏点/缺失/关闭）、设备视口与缩放、Edit/Run/Slides、撤销/重做、**Save**，其余动作收进 `⋯`（Export / Render export / Share / Unsaved changes / Reload / Refresh design files / Templates / Brand / Assets / Media / Overview / Structure）。
3. 左栏 **Pages / Layers / Library**：Pages 是已打开页的缩略图行（Grid 开关切总览、`+` 进模板），Layers 是源码结构树；Library 内嵌 Assets / Templates / Brand / Media 四个页签，表单型 Brand / Media 顶部只有一行工具动作（Expand 抬到至少 320px、Open in dialog 打开兼容对话框）。模板在内嵌视图安装成功后自动切回 Pages 并打开入口页。宽档常驻可拖宽，中档只留图标条、面板抽屉覆盖画布，窄档经左上角按钮打开整栏抽屉。
4. 画布是主区域：点击元素后右侧检查器显示 **Design / Styles / History** 三个页签。Design 按元素类型分组（Text / Link / Image / Typography / Fill & border / Size & spacing / Structure），可折叠并记住状态；修改后底部吸底条显示 pending 数量，**Apply changes** 一次提交（保留一条撤销记录），**Discard** 复位。
5. Agent 交接收敛为画布底部的输入条：有选区 → 修改该元素，无选区 → 生成页面；`Context` 打开发送前预览，发送后把完整上下文**预填**到当前聊天（不自动发送）。页面有未保存修改时输入条禁用并就地提供 Save。
6. 保存成功后自动创建版本快照；**History** 页签可查看版本列表、保存手动版本、对比差异，并把工作区恢复到所选版本（恢复前会自动保存当前状态）。
7. 焦点在面板内时可用 **⌘S / ⌘Z / ⇧⌘Z**（Windows/Linux 用 Ctrl）；预览 iframe 内按键仍交给页面自身。
8. **Reload**（`⋯` 菜单）会丢弃当前未保存修改并读取磁盘文件。外部修改与本地草稿冲突时，保存会拒绝覆盖，画布顶部出现阻断横幅。

## 原型范围

- 桌面及桌面浏览器工作区；静态 HTML/CSS、本地图片和字体。
- 预览不执行作品自己的 JavaScript 或事件处理器，外部网络资源不加载；源码中的脚本不会因预览而删除。
- 文字编辑只处理纯文本元素；包含子元素的容器可以改颜色，复杂布局或结构修改交给 Agent。
- 不提供任意 React/Vue 源码反向编辑、开发服务器代理、多人协作、导出或 Open Design 模板市场。

## P1 编辑与恢复（2026-10-23）

精确编辑与持久历史已落地，设计与验收细节见 [P1 实现设计](plans/2026-10-23-design-workbench-p1-implementation.md)：

- **精确源码修改**：客户端编辑引擎基于 parse5 源码位置做最小字节替换，只改目标文本或内联 style 声明；注释、实体、无关属性与换行逐字节保留。隐式节点、重复属性、文本指纹失配与过期修订一律拒绝，不猜测匹配目标；选区消息绑定草稿修订，迟到的 iframe 消息不会修改新版本。
- **撤销/重做**：每文档有界快照式历史（默认 100 条 / 32 MiB，连续同类编辑合并），保存后仍可撤销为新草稿，外部接管/重载/恢复后重建基线。
- **样式覆盖**：只写选中元素的 inline 声明并支持清除；外部 `!important` 等导致修改未生效时，面板通过预览计算样式回读提示原因，不静默提高优先级。
- **统一写入边界**：保存走 `server/src/infra/fs/safe-file-write.ts`（按文件互斥、修订校验、写前备份至数据目录、原子替换）；设计保存与宿主文件工具可共用该模块（pi-runtime 迁移另立 PR）。
- **持久快照与版本恢复**：内容寻址 blob 存 `~/.zclaudia/design-snapshots/`，清单入 SQLite（migration 050）；捕获入口 HTML 与引用的本地 CSS/图片/字体（2 MiB/10 MiB/50 MiB/200 条上限），未捕获资源明示。恢复采用 pre-restore 快照 + 冲突校验 + 暂存 + 顺序改名 + 操作日志，中断如实三段报告，不声称跨文件原子。快照按 workspace 根目录归属：同一工作区的多个聊天看到同一份历史。
- 现存限制：HTTP 保存为 SHA-256 修订校验下的原子替换，未共用锁的外部进程仍存在极短并发窗口；快照校验一致不等于同一时刻一致；恢复中断的恢复路径是 pre-restore 快照。
- 远端请求沿用当前 backend 的 API 通道，不向 iframe 传入地址或凭据；远端设备仍需单独验证。macOS Tauri WebView 已完成下述本机实测。

## P2 完整静态工作台（2026-10-23）

面板从单文档扩展为多页工作台，设计与验收细节见 [P2 实现设计](plans/2026-10-23-design-workbench-p2-implementation.md)：

- **页面组织**：文件标签（脏点/缺失标记/关闭确认）、页面总览缩略图、最近打开与每页草稿；纯 TS 多页控制器按工作区 identity 注册（同工作区多聊天共享草稿，进程内跨会话存活），UI 偏好持久化 localStorage；最多 8 页，LRU 淘汰干净页；文件删除/改名标 missing 并可保存重建（`allowCreate`）。
- **画布视口**：充满/桌面 1280/平板 768/手机 390/自定义宽度；缩放为纯显示 transform（25%–200% + 适应），iframe 布局宽度只由视口决定，不写 CSS、不改响应式逻辑视口。
- **资源变化传播**：新增 `GET /api/design/deps`（资源图 stat：mtime/size/missing，不哈希）；面板可见时 2s 轮询 + 外部 agent 文件事件（chatMessageStore 指纹）400ms 去抖即时刷新；CSS/图片 mtime 变化即触发预览重建（assetEpoch），脏页保留草稿并提示外部更新；隐藏/关闭面板即停轮询。
- **源码联动**：选区「查看源码」以 parse5 偏移计算草稿行号并跳转现有文件查看器（脏页明示行号偏移与「查看器显示已保存版本」）；「未保存差异」复用行级 diff 对比草稿与磁盘基线。
- **基础导出**：`POST /api/design/export` 打包入口 HTML 与本地资源（工作区相对路径原位 + `zclaudia-export.json` 清单，jszip/DEFLATE）；disk 模式以 expectedRevision 钉死明确版本，draft 模式显式携带草稿；缺资源默认 409 `EXPORT_INCOMPLETE`，确认后包内清单标注 missing；桌面经 Tauri 落盘 Downloads（复用 fileDownload 通路）。
- 写入边界新增 `createIfMissing`（重建保存走同一临时文件+终检+原子替换路径）；错误码新增 `EXPORT_INCOMPLETE`/`EXPORT_LIMIT_EXCEEDED`（含 CSS 深度超限）。
- 待补：真实 Agent + macOS Tauri 冒烟（三页作品全流程、设备视口实机、ZIP 离线解包）、远端 backend 验证。

## P3 扩展可视编辑（2026-10-23，P3.1–P3.4）

可视编辑从文字/双色扩展为日常排版能力，全部继续经过 P1 事务管线（撤销/保存/冲突语义继承），设计与验收细节见 [P3 实现设计](plans/2026-10-23-design-workbench-p3-implementation.md)：

- **排版与盒模型**：24 属性白名单（字体/字号/行高/字重/对齐/宽高/内外边距/边框三件套/圆角/颜色），逐属性单位与范围校验（多值简写、负 margin、auto、关键字集），每属性可清除 inline 覆盖；编辑器按计算样式预填并标注「内联」徽标；简写与长写共存按 CSS 后写者胜。
- **图片与链接**：`src`（工作区图片清单选择 `GET /api/design/assets` + 相对路径换算，保持可移植）、`alt`、`object-fit`、`href`（拒 javascript:/data:/vbscript:）；链接文字沿用文字编辑。
- **元素导航**：父级/子级按钮 + 元素结构树（源码构建，含 id/class/文本预览、SVG/隐式/超深能力边界中文原因、截断标记），经 `zclaudia:design-select-path` 桥接消息高亮并回发标准选区（携带计算样式/白名单属性/inline style）；伪元素与脚本生成节点不出现（能力边界明示）。
- **受限结构修改**：复制（副本 id 全量 `-copy` 去重 + 内部锚点同步重写）、删除（子树 id 被子树外锚点引用即拒绝 `ANCHOR_REFERENCED`，删除后选父级）、上移/下移（同父级交换，中间字节保持）；结构操作独占事务，一次操作一条撤销记录，修改后自动重选刷新定位。
- **覆盖提示扩展**：应用后自动重选并按属性对比表核对计算样式（颜色等价、关键字、纯 px 数值、font-weight 归一；无可靠口径的键跳过），失配显示既有 override 提示；纯颜色应用沿用 verify 回路。
- 错误码新增 `ATTRIBUTE_NOT_ALLOWED`/`STRUCTURE_NOT_ALLOWED`/`ANCHOR_REFERENCED`；P3.5（CSS 来源编辑）为独立后续批次。

## P3.5 CSS 来源编辑（2026-10-24）

选中元素的「样式来源」区展示命中的样式表规则与覆盖原因，并支持受控的声明级修改，分两批交付（第一批规则展示与页面内 `<style>` 块写回，第二批外部 `.css` 写回），设计与验收细节见 [P3.5 实现设计](plans/2026-10-24-design-workbench-p3.5-implementation.md)：

- **规则来源与生效徽标**：命中规则按来源分组——入口 `<style>` 块（`@inline/<n>`）与工作区相对 CSS 路径；Active/Overridden 生效徽标仅按计算样式键口径展示（20 键 + `color`/`background-color`，与重选对比同口径），`!important` 只作标记、不做完整级联模拟。
- **匹配仲裁在浏览器**：预览 iframe 内枚举 CSSOM 并对选择器逐个 `matches()`，宿主只做 origin + rulePath + selectorText 的源码指纹对齐（postcss 为既有依赖，零新增），对不上即只读、不猜测定位；只读四原因 `parse-error`/`align-mismatch`/`external-css-readonly`/`oversize`（外部 `.css` 编辑已在第二批放开，该原因仅作外部文件获取失败的兜底），另有规则数超上限的截断提示。
- **页面内 `<style>` 块编辑**：声明改值/删除/新增走 P1 事务管线（撤销/合并/保存/冲突/快照全部继承，无关字节逐字保持）。
- **外部 `.css` 编辑**：per-file CSS 草稿（进程内存活、有界撤销，`cssDraftEpoch` 自增驱动预览即时内联），「Save styles」显式保存走 SHA-256 修订校验，409 时提供「保留草稿/重新载入」两选项；ZIP 导出不包含未保存的 CSS 草稿，导出对话框明示。
- **能力边界**：`@import` 嵌套文件只读；远程样式表在预览构建时移除、不出现；不做规则增删/选择器编辑/CSS 重排；内联 style 属性不经来源区编辑（沿用 P3.1 的 24 属性 inline 面板）；`.css` 不进标签页/多页控制器。
- 待补验证（手工门槛）：真实 Agent + macOS Tauri 冒烟（选卡片查看规则来源 → `<style>` 块与外部 `.css` 各改一处 → 撤销 → 保存重载一致 → 外部改文件后保存被 409 拒绝）。

## P4 模板与品牌体系（2026-10-23）

模板、品牌、素材与「发送前可见」的 Agent 上下文组合，设计与验收细节见 [P4 实现设计](plans/2026-10-23-design-workbench-p4-implementation.md)：

- **使用方式**：工具栏新增 **模板 / 品牌 / 素材** 三个入口（与活动页无关，随时可开）。**模板** 对话框列出内置模板目录，一键安装到工作区（409 冲突需显式「覆盖重装」），安装成功可直接打开入口页，作品与模板互不影响、可独立继续编辑；**品牌** 面板在两文件缺失时提供表单生成 `design/DESIGN.md` + `design/tokens.css`，已存在时切换为带修订校验的文本编辑；**素材** 库按图片/字体分页浏览与导入（重名自动加后缀永不覆盖），可把选中的 `<img>` 替换为素材相对引用。
- **上下文检视**：**生成页面 / 交给 Agent 修改** 不再直接填入聊天，而是先组装上下文（工作区、各页修订与草稿状态、选中元素定位与源码片段、品牌全文、活动页素材引用与本会话最近导入、当前视口），在检视模态里完整展示，确认后才填入聊天（保留追加语义与提示条）；取消则不填入。品牌文件在面板挂载时拉取缓存、保存成功后刷新。
- **Agent 反馈横幅**：面板可见时监视本会话 run 结束（runId 非空 → 空），对比前后磁盘文件清单与打开页修订，以 `role="status"` 横幅报告「Agent 已写入 N 个文件」或未检测到变化；新增/变化的文件以可点 chip 打开对应页面，右侧 × 关闭；run 报错时在文案后注明；对修订变化的打开页自动创建 `Agent 时间` 恢复点快照。
- **能力边界**：无全局素材库（素材即工作区文件）、无选区截图；品牌表单仅在两文件首次生成时提供（此后走文本编辑）；Agent 写入的成功信号来自磁盘对比（文件清单 + 修订），失败与取消以横幅文案如实呈现；上下文只经当前 backend 的 API 组装，不跨 backend。
- 待补：真实 Agent 冒烟（沿用 P3 口径，M2 门槛）。

## P5 交互原型与演示文稿（2026-10-23，P5.1–P5.4）

预览从「只读静态」扩展为三态模式（编辑 / 运行 / 演示），并新增幻灯片与客户端渲染导出；全部客户端实现，服务端与 `api.ts` 零改动，设计与验收细节见 [P5 实现设计](plans/2026-10-23-design-workbench-p5-implementation.md)：

- **三态模式**：编辑模式与 P1–P4 完全一致（脚本与 on\* 剥离、选区桥接可用）；**运行模式**为页面级交互执行——作品脚本保留（本地脚本内联、远程脚本移除并计数）、CSP `connect-src 'none'` 拒绝一切网络、opaque origin 下以桥接注入的内存存储 shim（可用不持久）、sandbox 维持 `allow-scripts`（弹窗/表单/顶层导航全禁）。三态策略边界（脚本/网络/导航/存储/弹窗/桥接/选区）见 [P5 实现设计 §1 策略表](plans/2026-10-23-design-workbench-p5-implementation.md)。工具栏「编辑/运行」分段按钮切换；运行模式为只读体验：隐藏选区编辑区与结构树、禁用「交给 Agent 修改」，状态条固定提示并显示被移除的外部脚本/链接计数（均 0 时省略）。预览缓存键扩为 `草稿修订:资源纪元:模式`，切模式即按新模式重建。
- **运行导航**：相对 `.html`/`.htm` 链接由构建期打标、运行期经 `design-navigate` 桥接上报宿主开页（path 经长度/反斜杠/控制字符/scheme 校验且必须在文件清单内）；`#锚点` 放行；外部链接与非 HTML 相对链接被阻止并经 `design-nav-blocked` 上报。提示条出现在预览区上方，5 秒自动消失或手动关闭。
- **deck 约定与操作**：源码内任意元素带 `data-zclaudia-slide` 即一页（文档顺序 = 页序，≤60 页），可选 `data-title`/`data-notes`，比例存 `<body data-zclaudia-deck-ratio="16:9|4:3">`（缺省 16:9）。deck 是普通 HTML 页：经既有编辑链路可编辑、保存、快照、ZIP 导出。检测到标记后工具栏出现可用「幻灯片」按钮（无标记则禁用并提示，保持工具栏稳定），面板支持缩略图、标题/备注编辑、同父级排序、增删页与比例设置；全部结构操作走 deck 纯函数源码块切片 + `controller.applySource` 原子草稿替换（继承撤销/修订/busy 链路，无关字节零改动）。切页时面板/播放器/渲染导出对话框一并关闭。「演示」打开全屏覆盖层播放器（请求全屏、失败静默降级），键盘翻页（←/→/PgUp/PgDn/Space/Home/End/Esc/N 备注），播放 HTML 剥离全部脚本、翻页由宿主处理，不执行作品脚本。
- **渲染导出边界**：全部客户端捕获（SVG foreignObject 光栅化 + 白底 canvas）。deck 页导出「导出 PDF（N 页 · 整页图片）」或逐页 PNG；非 deck 页导出视口区域（宽度 × 900px）单张 PNG——opaque-origin iframe 无法量测内容高度，不做整页高度捕获（已声明边界）。PDF 为整页图片 PDF（每页一张 JPEG 直通嵌入，无文字层），界面与文档统一口径「**整页图片，不可编辑文字**」，不与可编辑导出混称；PPTX 不提供（可行性结论见 P5 实现设计 §8）。导出内容 = 当前预览（草稿源码 + 磁盘资源内联，含未保存修改，对话框明示）；单页失败进错误列表、其余页继续；捕获不可用/失败显式报错（`capture-unsupported`/`capture-failed`），不静默。真实 macOS Tauri（WKWebView foreignObject 光栅化）与浏览器实测为 M3 手工门槛。
- 待补：真实浏览器与 macOS Tauri 下的渲染捕获、运行模式与全屏演示实测（M3 门槛）。

## P6 图片与视频能力（2026-10-24）

工具栏新增 **媒体** 入口（与活动页无关）：图片生成 / 图片编辑 / 动效视频共用一个媒体生成面板，生成任务经 design 域自建表（migration 051）按工作区归属管理；面板内提交、进度轮询、取消与重试，产物直接落地工作区素材库，设计与验收细节见 [P6 实现设计](plans/2026-10-24-design-workbench-p6-implementation.md)：

- **媒体任务接口**：提交参数服务端校验/规范化后入队（并发上限：图片 2、视频 1，超出排队）；同工作区同参数在跑被内容去重拒绝（409「已有相同任务在进行中」）；进行中可取消（相关进程退出，已写入产物保留并如实标注）；失败任务「重试」先经确认对话框（明示「将重新提交生成请求，可能产生费用」）再以原参数新建。进度经面板打开期间的 2 秒 HTTP 轮询展示阶段与帧数，不进全局任务中心。
- **图片服务与凭据**：首批唯一 provider `openai-images`（OpenAI 兼容 `images/generations` 与 `images/edits`，覆盖 CogView 等）；凭据复用宿主 llm_profiles，媒体端点只返回 `hasCredential` 布尔，密钥材料不返回、不落任何设计文件。
- **费用口径**：任务快照提交时所选服务（profile 名 + 模型），事后改名/删除不影响历史展示；服务返回 usage 则展示 tokens/费用，未返回则明示「费用未知（服务未返回用量）」，不做本地估算报价。
- **动效视频**：服务端 headless Chrome（puppeteer-core + 既有 Chrome 发现）打开工作区 HTML，按墙钟 screencast 采集帧，系统 ffmpeg（`FFMPEG_PATH` → PATH → 常见 brew 路径）编码 H.264 yuv420p 分片 MP4，无新 npm 依赖；**无音轨**（无头采集平台相关，`--mute-audio`，界面与文档明示）；**近似实时采集**（非帧确定渲染，同参数同依赖可重跑同一路线，不承诺与浏览器实时呈现逐帧一致）；Chrome/ffmpeg 缺失时任务失败并附安装提示。
- **产物落地**：图片走素材导入链路（重名自动加后缀、≤10 MiB）、视频走同款永不覆盖写入（≤256 MiB）落到 `design/assets`——**生成失败不替换原素材**；被页面引用并保存后自然进入 P1 快照与 P2 ZIP 导出（视频已入资源图与快照 kind，素材库新增视频分页：列清单与体积、无缩略图、不支持导入）。
- **传输**：任务结果经专用端点二进制流式下载（Content-Disposition 附件，不经 base64 JSON）；客户端下载落盘，视频以 blob 内存组装（≤256 MiB）内嵌 `<video>` 预览。
- 待补验证（手工门槛）：真实付费图片服务（CogView/OpenAI）生成、编辑与替换到页面冒烟；macOS Tauri 内嵌服务端的视频渲染实测（Chrome + ffmpeg 就绪机器）；费用与服务控制台用量核对。

## P7 分享与审阅（2026-10-24）

工具栏新增 **分享** 入口（需存在打开且非 loading 的活动页）：把作品某个不可变版本快照发布为 `/s/<token>` 能力链接供评审者浏览与评论，评审评论可一键交接给 Agent 修改并自动形成新恢复点，设计与验收细节见 [P7 实现设计](plans/2026-10-24-design-workbench-p7-implementation.md)：

- **不可变分享**：分享引用 P1 内容寻址快照（不复制第二套作品库），旧分享不随本地修改变化；存在未撤销分享的快照在 500 条裁剪中被 pin 保留；撤销与未知 token 一律 404（不区分存在性）、已过期 410；撤销不删除内容（可再出新分享，v1 无恢复撤销）。
- **访问范围与身份**：`link`（任何持有 token 者）/`local`（仅本机访问者）两档 scope；token 为 256 位随机（知悉链接即权限），无账号体系，评审者自报姓名（缺省「匿名」）；创建响应给出绝对 shareUrl 与尽力而为的局域网地址。
- **静态分享视图**：`/s/<token>` 单页（无框架、无外链资源），iframe `sandbox="allow-same-origin"` 无 `allow-scripts` 且文件端点 CSP `default-src 'none'`——作品脚本永不执行，表单、弹窗与链接跳转被拦截并提示；文件仅限清单内路径（穿越与清单外 404），不暴露本机绝对路径、sessionId，无任何列举端点。
- **元素评论与失效判定**：评审者在视图内点击元素发表评论，定位载荷（elementPath/tagName/text）与桌面选区同构；桌面侧对新版本源码做严格匹配（路径越界/标签不符/文本不符即失效并显示原因徽章），绝不静默挂到其他元素；评论无通知，面板手动刷新；所有者可标记解决（v1 无评论编辑/删除）。
- **交接 Agent**：评论列表「交给 Agent 修改」把评论原文、分享版本、快照与当前两版的定位结果（快照片段或失效原因）与任务指令组装为中文 prompt 填入当前聊天；定位失效也允许交接，但明确要求 Agent 修改前自证定位；Agent 写入后的新恢复点由既有 run 反馈自动快照（P4.5）承担。
- **端点清单**：公开侧（无会话鉴权，token 即授权）`GET /s/:token` 视图 HTML、`GET /s/:token/manifest.json` 清单、`GET /s/:token/f/*` 清单内文件、`GET|POST /s/:token/comments` 评论读写；所有者侧 `POST /api/design/shares` 创建、`GET /api/design/shares` 列表、`POST /api/design/shares/:id/revoke` 撤销、`GET /api/design/shares/:id/comments` 评论读取、`POST /api/design/shares/:id/comments/:commentId/resolve` 解决切换。
- 已知边界：分享为单入口快照（该入口 HTML 的资源闭包，不打包工作区其他页面，快照内链接跳转在分享视图被拦截）；无账号与更细权限粒度；评论无通知/推送（手动刷新）；局域网访问需 `SERVER_HOST=0.0.0.0` 或 `ZCLAUDIA_ALLOW_LAN=1`（此时该客户端其余 `/api` 仍需 Bearer，仅 `/s/*` 凭 token）；撤销后内容保留（行与 blob 由 pin 保住）；不完整快照可分享但如实标注 incompleteReasons；多人同时编辑（P7.4）仅评估不实现——维持单人编辑 + 快照审阅闭环，触发重评条件与方案对比见 P7 实现文档 §9。
- 待补验证（手工门槛）：真实第二客户端 LAN 冒烟（`SERVER_HOST=0.0.0.0` 下另一设备打开分享链接、浏览、评论）；macOS Tauri 内嵌服务端创建分享并由系统浏览器访问。

## P8 工作台布局重构（2026-10-24）

单独的设计工作台 UI 重构，视图层改动、编辑/预览/保存/快照语义零变化，设计与验收细节见 [UI 重构方案](plans/2026-10-24-design-workbench-ui-redesign-plan.md)：

- **单行顶栏 + 三栏骨架**：`layout/DesignWorkbench` 固定 `topbar / rail / canvas / inspector / status` 五个同级节点，只用 CSS Grid 模板与定位切换宽（≥960）/中（640–959）/窄（<640）三档；画布 iframe 不因切档、开合面板或切页签重挂载（有节点身份与 load 计数测试）。
- **检查器**：Design 页签按元素类型分组（`inspector/section-matrix.ts`），折叠用 grid-rows + `inert` 不卸载表单状态；统一吸底应用条（pending 计数 / Discard / Apply changes，批量提交语义不变）；Styles 与 History 成为同层页签，Head 为可点击面包屑（`inspector/breadcrumb.ts`）。
- **左栏**：Pages（`rail/PageThumbnail` 可见性门控 + `PagesView` 未打开文件分组）、Layers（`ElementTree` 去高度上限 + 帮助 Tooltip）、Library（内部四个页签全部内嵌：`AssetLibraryView` / `TemplateView` / `BrandView` / `MediaGenView`；原 `AssetLibrary` / `TemplateDialog` / `BrandPanel` / `MediaGenPanel` 对话框保留为薄壳）、可拖宽 200–420。Brand 内嵌首次激活或会话变化时加载，切页签/收起左栏/打开对话框都不丢未保存草稿且不重拉；Media 内嵌在非活动时渲染 null 并暂停任务轮询，内嵌与对话框恰好一个活动面。240px 栏下的紧凑布局无横向溢出（Logo 堆叠选择、媒体短标签、服务/尺寸纵排、视频参数两列网格、任务动作换行）。
- **Agent 输入条**：`agent/AgentBar` 取代 Generate page / Hand off to Agent 两个按钮；`buildDesignAgentContext` 新增可选 `request` 参数（缺省输出与旧快照逐字节一致），发送后仍只预填到聊天。
- **通知模型**：`hooks/useDesignNotices` + `layout/NoticeStack` 取代六种整行横幅的瞬时部分；外部变更 / 缺失 / 页面错误等阻断信息留在画布顶部 `CanvasBanner`，保存态、运行模式计数与视口/缩放移入 26px 状态条。
- **布局持久化**：`stores/designLayoutStore`（`zclaudia-design-layout-v1`，全局）保存左右开合、页签、左栏宽度与检查器分组折叠；抽屉开合是临时态。
- **快捷键**：面板内 `⌘S` / `⌘Z` / `⇧⌘Z`（`hooks/useDesignShortcuts`），Tooltip 在接线后才显示快捷键。
- 测试：`DesignPanel` 用例改为经 `⋯` 菜单 / 左栏 / Agent 条进入；新增 `useElementTier`、`designLayoutStore`、`DesignWorkbench`（不重挂载）、`TopBar` 相关、`section-matrix`、`collect-operations`、`breadcrumb`、`Inspector`、`AgentBar`、`NoticeStack`、`StatusBar`、`PagesView`、`ViewportBar`、`PageTabs`、`useDesignShortcuts` 等用例；P4c 另加 `BrandView`（首次激活/草稿保留/身份切换/resetOnHide）与 `MediaGenView`（非活动不请求、轮询暂停/恢复、表单保留）以及 `DesignPanel` 内嵌入口、Expand、Open in dialog 与活动面互斥用例。
- **真实应用走查修复（2026-10-25）**：画布 flex 链未撑满导致预览只有 150px 高；Tailwind 缺 `sidebar` 语义色映射使 `bg-sidebar` 透明；medium 档面板的 `hidden` 属性被 `flex` 类覆盖而无法收起；窄档底部面板固定 260px 下限在矮工具面板中挤占画布并压住状态条（改为按实测高度收敛，至少给画布留 96px）；AgentBar 在零高画布上覆盖顶栏（窄档贴底紧凑形态）；Context popover 超出画布（限高 + 内部滚动）；吸底 Apply 与 Version history 头部在 300px 检查器内换行（nowrap/分行）。
- 剩余批次（未在本轮落地）：P5a 合并 Export & Share 为三页签对话框、P5b 把 DeckPanel 内容搬进左栏 Slides 页签（当前打开原面板）。P4c 的 Brand / Media 内嵌已完成（`BrandView` / `MediaGenView` + 薄壳对话框）。

## 模块边界

- `apps/desktop/src/features/design/`：面板与组件（多页标签/视口/总览/导出对话框/元素结构树/模板对话框/品牌面板薄壳/素材库/上下文检视，以及 P5 的幻灯片面板/播放器/渲染导出对话框、P6 的媒体生成视图 `rail/MediaGenView.tsx` 与薄壳 `components/MediaGenPanel.tsx` + 媒体任务 hook `media-task-client.ts`、P4c 的品牌视图 `rail/BrandView.tsx` 与薄壳 `components/BrandPanel.tsx`、P3.5 的样式来源面板 `components/StyleSourcePanel.tsx`）、静态预览（含选区导航桥接）、交互运行预览（`interactive.ts`：运行 CSP/桥接/存储 shim/脚本内联）、deck 纯逻辑（`deck.ts`：解析/排序/增删/备注/比例/播放过滤）、客户端渲染导出（`render-export.ts`、`pdf.ts`）、精确编辑引擎（`html/`：样式/属性/结构操作与值校验）、样式来源对齐（`css-source.ts`）与 CSS 草稿（`css-drafts.ts`）、撤销历史（`history/`）、行差异（`diff.ts`）、多页工作台核心（`workspace/`：controller/storage/ports/source-lines）、元素树（`element-tree.ts`）、图片相对引用（`asset-ref.ts`）、品牌渲染与校验（`brand.ts`）、Agent 上下文组装（`agent-context.ts`）、run 结束监视（`agent-run-watch.ts`）、backend-aware API 客户端。
- `apps/desktop/src/plugins/builtinPanels.ts`：原生内置面板注册。
- `server/src/application/design/design-service.ts`：从会话解析工作目录、限定文件访问、版本校验和保存（含 allowCreate 重建），并含 `.css` 文档读写（P3.5）。
- `server/src/application/design/snapshot-service.ts`、`restore-service.ts`、`resource-graph.ts`：快照捕获/清单、分阶段恢复、HTML/CSS 资源引用图。
- `server/src/application/design/deps-service.ts`、`export-service.ts`：资源 stat 轮询与 ZIP 导出。
- `server/src/application/design/media-types.ts`、`media-task-service.ts`、`media-image-provider.ts`、`video-render-service.ts`（P6）：媒体任务契约与服务（自建表、状态机、去重、并发调度、取消与重启收尾、产物永不覆盖写入）、openai-images provider、视频渲染执行器。
- `server/src/application/design/template-catalog.ts`、`template-service.ts`、`brand-service.ts`：内置模板目录与安装（TEMPLATE.json 标记、覆盖语义）、品牌文件读写（DESIGN.md/tokens.css 渲染与修订校验在 desktop `brand.ts`）；`design-service.ts` 增加素材导入（白名单/上限/自动去重）与素材清单 kinds。
- `server/src/infra/design/blob-store.ts`：内容寻址快照存储；`server/src/infra/fs/safe-file-write.ts`：共享文件写入边界（锁/修订/备份/原子替换/缺失重建）。
- `server/src/interfaces/http/design.ts`：已有认证中间件保护的 `/api/design` 路由（文件、快照、恢复、依赖、导出，以及 P4 的模板目录/模板安装/品牌读写/素材清单扩展/素材导入共六个端点，与 P6 的媒体服务清单/任务提交/取消/结果流式下载媒体端点）。

预览使用不含 `allow-same-origin` 的 sandbox iframe。宿主只接收目标 iframe 且 channel 匹配的元素选择消息；预览资源通过受认证的宿主 API 读取后内联，不让作品自行访问宿主文件接口。

## 验证

```sh
bash scripts/with-project-node.sh pnpm --filter @zclaudia/server exec vitest run src/interfaces/http/__tests__/design.test.ts src/infra/fs src/application/design/__tests__
bash scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec vitest run --config vitest.ui.config.ts src/features/design
pnpm browser:build
bash scripts/with-project-node.sh env E2E_BROWSER_CHANNEL=chrome pnpm exec playwright test --config e2e/playwright.agent-runtimes.config.ts design.playwright.spec.ts
```

浏览器验收使用独立临时数据目录和确定性的 Claude CLI 测试桩，经过真实插件 adapter、聊天消息和文件接口，验证生成、本地资源预览、可视编辑保存、同一会话续改、外部写入冲突和重新打开。它验证应用集成，不评价真实模型的设计质量。

P1 单元/接口测试覆盖：逐字节源码保留、重复节点与过期选区拒绝、隐式节点与重复属性拒绝、撤销/重做与保存边界、并发写入互斥与过期修订拒绝、快照捕获/去重/隔离、恢复冲突与中断三段报告、路径越界与错误 snapshotId 防护（证据见 [P1 实现设计 §8.7](plans/2026-10-23-design-workbench-p1-implementation.md)）。

P2 测试覆盖（desktop 220 + server 69 + fileDownload 30，全绿；双端 tsc/eslint 与 react-lifecycle/radius 约束检查通过）：多页打开/编辑/保存互不串扰、8 页上限与 LRU 淘汰、身份隔离与 dispose 陈旧防护、missing/allowCreate 重建、deps stat 变化触发预览重建、可见门控与消息指纹去抖轮询、视口与缩放互不干预、导出解包相对路径原位与清单一致、缺资源 409 与 confirmIncomplete 放行、draft/disk 模式与版本钉（证据见 [P2 实现设计 §10](plans/2026-10-23-design-workbench-p2-implementation.md)）。

P3 测试覆盖（desktop 435 + server 72 + fileDownload 30，全绿；双端 tsc 0 错、eslint 0 error、lifecycle/radius 通过）：24 属性校验逐类合法/非法样本、简写/长写共存与清除语义、无关字节逐字节保持、属性标签匹配拒绝、duplicate 的 id 去重与内部锚点重写、delete 锚点引用拒绝与选父级、move 交换公式与首末拒绝、结构操作混用/根元素拒绝、桥接 select 载荷与 select-path/select-failed 回路、树 capability/truncated/childElementPath、表单分组渲染与预检拦截、图片清单选择与相对路径换算、应用后重选对比（含混合事务颜色失配锁定用例）、纯颜色 verify 回路回归（证据见 [P3 实现设计 §10](plans/2026-10-23-design-workbench-p3-implementation.md)）。

P3.5 测试覆盖（desktop 885 用例全绿、server 272 通过 + 1 skipped；双端 tsc 0 错、eslint 0 error / 37 warning 基线）：预览来源标记与规则枚举桥接、源码指纹对齐与只读原因、`styleBlock` 事务逐字节保持、样式来源面板与「Save styles」冲突两选项、服务端 `.css` 读写与 409 冲突、CSS 草稿与预览即时内联（证据见 [P3.5 实现设计 §11](plans/2026-10-24-design-workbench-p3.5-implementation.md)）。

P4 测试覆盖（desktop 524 + server 115，全绿；双端 tsc 0 错、eslint 0 error、lifecycle/radius 通过）：模板目录不变量（骨架/无脚本/无外链/大小/语义分区）与安装全链路（409 files/覆盖重装/symlink 403/并发 403）、品牌读写修订语义与两文件独立写入、素材导入白名单/上限/重名去重/越界拒绝、kinds 向后兼容、品牌渲染器与校验、上下文组装快照与截断、run 反馈 diff/文案/快照失败附注/防抖与清理、三对话框与检视模态、面板接线（生成/续改经检视、横幅 chip、品牌缓存与最近导入入上下文）（证据见 [P4 实现设计 §9](plans/2026-10-23-design-workbench-p4-implementation.md)）。

P5 测试覆盖（desktop 651 用例全绿；desktop tsc 0 错、eslint 0 error、lifecycle/radius 通过；服务端零改动）：运行构建器脚本内联/远程移除计数/上限/导航标记与 blocked 统计、桥接 nav/blocked/存储 shim/CSP、deck 解析与排序/增删/备注/比例的逐字节保真、60 页与转义边界、PDF 字节结构（xref/DCTDecode 直通）、捕获请求组装与文件名、DeckPanel 乐观更新与回退、DeckPresenter 键盘翻页与全屏降级、RenderExportDialog 进度/取消/错误列表；面板集成（L25）：模式分段按钮 aria-pressed、切运行模式隐藏编辑区与缓存键分叉（run 构建器被调而静态构建器不重复）、blocked 计数状态条、navigate 清单内开页/清单外提示、nav-blocked 两类 reason 提示与手动关闭、deck 检测与幻灯片按钮可用性、DeckPanel/DeckPresenter/渲染导出对话框挂载与回调连线（onCommit → controller.applySource、切页三者关闭）、非 deck 页 deck=null 的 PNG 视口模式（证据见 [P5 实现设计 §9.5/§10](plans/2026-10-23-design-workbench-p5-implementation.md)）。

P6 测试覆盖（desktop 682 + server 224 用例全绿；双端 tsc 0 错、desktop eslint 0 error / 34 warning、lifecycle/radius 通过）：图片 provider 的 b64/url 两形态与 magic bytes、非 2xx/超时/外部中止/私网 URL 失败映射、edit 不支持识别；媒体任务生命周期（状态机、同参数去重 409、并发上限排队调度、取消收尾与重启中断标记、保留 100 条）；视频执行器（依赖缺失、零帧、输出超限、取消击杀真子进程）；媒体路由（providers 仅 `hasCredential` 无密钥材料、结果流式下载响应头）；媒体面板（三 tab 参数校验、2s 轮询、重试确认、409 去重文案、blob 预览对象 URL 回收）；面板接线（L36）：媒体按钮打开面板与会话/活动页/选区就绪 props 透传、img 选区就绪与「替换选中图片」src attribute 事务（相对引用换算）、产物落库回调刷新工作区、切页关闭（证据见 [P6 实现设计 §12](plans/2026-10-24-design-workbench-p6-implementation.md)）。

2026-10-23 本机实测：在 macOS 的 Claudia Dev（Tauri 开发版）中，通过真实 Codex CLI 会话生成 `design/index.html`、本地 CSS 和 5 个 SVG；设计面板自动发现并显示页面。点击纯文本主标题，修改文字与颜色，应用并保存后，直接检查磁盘 HTML 确认写入，再重新载入并重新选择标题，确认文字及计算颜色仍然一致。体验项目位于 `/Users/zhvala/SourceCode/zclaudia-design-demo`，会话名为 `Codex · 设计闭环体验`。

此前一次真实 Claude CLI 尝试停留在重复的 `ToolSearch` 调用，未写文件，已取消。该次 CLI 为 2.1.304，超过运行时已测试上限 2.1.181；现有证据不能认定版本就是根因。此次原生闭环成功结果来自 Codex，不计为 Claude 实测通过。

## 端到端真实验收（2026-10-24）

以 dynamic workflow 编排逐场景 sub-agent、经仓库本地 Playwright 驱动真实 Chrome（有头）操作真实应用与真实 Codex/Claude CLI 子进程，无人值守完成主计划 M1–M3 与 P3.5 的**浏览器路径全链路验收**（生成→可视编辑→撤销→保存→冲突→版本恢复→ZIP 导出→品牌续改→样式来源→运行模式/deck→分享审阅→交接修改；179 处证据引用零缺失），设计与结论见 [验收报告](plans/2026-10-24-design-workbench-e2e-acceptance-report.md)：

- **场景结果**：S1 主链路 / S2 品牌续改 / S3 样式来源 / S4 交互与 deck / S5 分享审阅（Playwright 独立上下文充当第二客户端）通过；S7 Tauri 实机因 computer use 不可用按计划留白。
- **初验发现并修复唯一阻塞缺陷**：Agent 交接落盘后反馈横幅误报「未检测到变化」且不建 `Agent 时间` 恢复点（4/4 真实 run 复现；根因 = watcher 在 run 结束才取 before，而面板 2s 轮询已在 run 期间收编磁盘写入）。当日修复（`67d63de4`，before 改在 run 开始捕获，回归测试 +2，887 用例全绿）并经真实环境聚焦复验三目全 pass（横幅 `Agent wrote 1 files`、恢复点入库、磁盘与预览双证）——验收报告 §7。
- **真实 Claude CLI 首次实测通过**：推翻上一段「不计为通过」的历史记录——CLI 2.1.304（cli 引擎模式）24 秒一次完成 hello.html 生成（单次 Write 工具调用，无 ToolSearch 循环、未触发熔断；验收报告 S6）。
- 留白（待用户配合）：macOS Tauri 实机（WKWebView 捕获/全屏播放/Downloads 落盘）、P6 付费图片（待配 key）、P7 LAN 第二设备、远端 backend、其他操作系统。
