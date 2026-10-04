# LanguageServerManager 实施计划

> 取代 [2026-09-23-tool-set-alignment-plan.md](2026-09-23-tool-set-alignment-plan.md) Task 9 的「后续」项。步骤用 `- [ ]` 跟踪。

**Goal:** 给 Pi runtime 接上真实语言服务器：先让 agent 改完代码立刻看到自己引入的编译错误（P0），再打开 LSPTool 做语义查询（P1），最后扩到更多语言并提供状态可见性（P2）。

**Architecture:** 新建 `server/src/infra/lsp/`，由一个 `LanguageServerManager` 统一管理进程、文档同步和诊断。现有 `LanguageServerPort`（给 LSPTool）和 `WriteDiagnosticsProvider` / `FileChangeNotifier`（给写后钩子）都只是它对外的接口，不再各自持有 transport。

**Tech Stack:** TypeScript、Vitest、`vscode-languageserver-protocol`（JSON-RPC 帧与协议类型）、`typescript-language-server@5`（随包附带）。测试命令：`bash scripts/with-project-node.sh pnpm --filter @zclaudia/server test -- <files>`。

---

## 已定决策（2026-10-04）

1. **配置来源先做内置预设。** 预设结构与将来插件 `contributes.lspServers` 完全一致，插件届时只是注册表的另一个来源。项目配置文件与插件声明都要做信任确认，留到 P3。
2. **TypeScript 随包附带，其他语言只探测。** `typescript-language-server` 作为 server 依赖随 zclaudia 发布；gopls / rust-analyzer / pyright 只在 PATH 上探测，不下载。自动安装留到 P3。
3. **接口按多使用方设计，P0–P2 只实现 agent 一侧。** manager 里不出现 runId / toolCallId / session，按 (presetId, workspaceRoot) 区分客户端，使用方用租约获取和释放。桌面端界面功能留到 P3。

## 核实结论（决定改法）

- **两套 LSP 抽象互不相通，且都没接线。** `language-server-port.ts` 只有接口，没有实现，server 里没人传 `languageServerPort`。`lsp-diagnostics-adapter.ts` 自带 `LspTransport`，但 `lspDiagnosticsAdapter`、`diagnosticsCommand`、`diagnosticsProvider` 在生产中都没人传值。编辑工具里的诊断分支和桌面端 `FileMutationResult` 的诊断显示从未触发过。
- **写后诊断即使接上，模型也看不到。** `edit-tool.ts` / `write-tool.ts` 只把诊断放进 `details.lifecycle`（给界面用），`buildMutationResultText`（`edit-write/mutation-details.ts`）不接收诊断。所以必须改结果文本，否则 P0 的价值为零。
- **adapter 的 500ms 超时会造成假阴性。** 超时后返回缓存，没有缓存就返回 `[]`；tsserver 冷启动要几秒到几十秒，模型会收到"没有错误"的假结论。
- **Node 版本约束。** `typescript-language-server` 6.0.1 要求 `node >= 22.22.2`，而 `.node-version` 是 22.20.0，内嵌 server 的 node sidecar 也从这个文件取版本（`server/scripts/bundle.mjs`）。所以固定 `^5`（5.3.0，`node >= 20`），除非另行升级 `.node-version`。
- **打包方式。** server 用 esbuild 打成 `bundle/server.mjs`，外部依赖列在 `external` 里。语言服务器是**独立子进程**，不能打进 server.mjs，必须作为文件复制进 bundle，再用 sidecar node（`process.execPath`）启动。
- **进程托管有现成机制。** `infra/services/process-supervisor.ts` 的 `ProcessSupervisor` 已经管着 `mcp_server` 等来源，Debug 页的 `ManagedProcessesSection` 读的就是它。新增 `language_server` 来源后，可见性和泄漏清理都能直接复用。退出流程在 `server/src/index.ts` 的 `shutdown`。
- **列号单位。** LSP 默认按 UTF-16 code unit 计列，JS 字符串下标本来就是 UTF-16，所以在行文本里按 `indexOf(symbol)` 算出的列号可以直接用，无需转换。初始化时仍要声明 `general.positionEncodings: ['utf-16']`。
- **安卓不受影响。** 安卓不跑内嵌 server，manager 只在 server 进程里，远程 backend 照样可用。

## 设计要点

### 模块划分

```
server/src/infra/lsp/
  presets.ts            内置预设表（结构 = 将来的插件 lspServers 条目）
  detection.ts          可执行文件探测：随包 TS 路径 + PATH 查找，异步刷新、同步读缓存
  client.ts             LspClient：通过 ProcessSupervisor 启动、JSON-RPC、initialize、处理服务器发来的请求、shutdown
  documents.ts          DocumentStore：版本号 + 内容哈希，syncFromDisk(file)，打开文档数上限（LRU didClose）
  diagnostics.ts        DiagnosticsStore：推送缓存 + 代数 + 等待者 + 防抖稳定 + 显式状态
  pool.ts               ClientPool：(presetId, root) → client；租约、空闲关闭、全局上限、崩溃退避
  manager.ts            LanguageServerManager：对外三类接口
  facades.ts            → LanguageServerPort / WriteDiagnosticsProvider / FileChangeNotifier
```

### manager 对外接口（草案）

```ts
interface LanguageServerManager {
  /** 同步、无副作用；只读探测缓存。空数组 = 该工作区没有可用服务器。 */
  serversFor(root: string): LanguageServerInfo[];
  /** 租约：有租约就保活；consumer 只是显示用的标签，manager 不解析它。 */
  acquire(root: string, consumer: string): { release(): void };
  /** 原 LanguageServerPort.query；查询前会先对涉及的文件做 syncFromDisk。 */
  query(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult>;
  /** 写后诊断：同步文件后等待稳定的推送，超出预算返回 pending 而不是空数组。 */
  diagnosticsFor(
    file: string,
    budgetMs: number,
    signal?: AbortSignal
  ): Promise<DiagnosticsSnapshot>;
  status(): LanguageServerStatus[];
  dispose(): Promise<void>;
}

type DiagnosticsSnapshot =
  | { state: 'ready'; diagnostics: LspDiagnostic[] }
  | { state: 'pending'; reason: 'starting' | 'timeout' }
  | { state: 'unavailable'; reason: string };
```

### 关键行为

- **查询前从磁盘同步。** Bash 里的 `sed`、代码生成、`git checkout` 都不经过写后钩子。任何请求前，对涉及的文件读磁盘、比对哈希，有变化就先发 `didOpen` / `didChange`。
- **诊断稳定判定。** 某次保存之后收到的第一次推送不一定是最终结果（可能先语法、后语义），收到推送后再等 150ms 没有新推送才算稳定。
- **只报新引入的错误。** 以该文件上一次稳定的诊断为基线，按 (message, source, code) 多重集比较，忽略行号漂移，只报新增的 `error` 级别诊断，最多 10 条。没有基线（文件第一次被打开）时报全部错误，同样最多 10 条，并注明"可能包含原有错误"。
- **生命周期。** 每个 Pi run 在开始时对自己的 cwd 获取租约，同时预热服务器；run 结束时释放。没有租约的客户端空闲 10 分钟后关闭；全局最多 3 个服务器进程，超出时 LRU 淘汰没有租约的客户端；崩溃后退避重启（1s 到 30s），5 分钟内崩溃 3 次就标记为 `failed`，不再重启。
- **工作区根 = 实际 cwd。** worktree 子代理的 cwd 不同，各自有独立的客户端，受全局上限约束。

## P0：manager 核心 + TypeScript + 写后诊断

- [x] **T1 依赖与打包验证。** server 加 `vscode-languageserver-protocol`、`typescript-language-server@^5`；`bundle.mjs` 把 `typescript-language-server` 包目录复制到 bundle 资源；新增 `resolveBundledTsServerPath()`，dev 下走 node_modules，release 下走资源目录。验证三件事：
  - dev 下能用 `process.execPath` 起 `--stdio`；
  - macOS release 包里能起（手动冒烟）；
  - 项目没有 `node_modules/typescript` 时的行为（是否回退到自带的 TypeScript）。若不回退，探测条件改为"项目里能解析到 `typescript`"。
- [x] **T2 LspClient。** 通过 `ProcessSupervisor.spawn` 启动，新增来源 `language_server`；JSON-RPC 走 stdio；`initialize` 声明 UTF-16、`publishDiagnostics`、`callHierarchy` 等能力并记录服务器支持哪些；处理服务器发来的请求（`workspace/configuration` 返回空配置、`window/workDoneProgress/create`、`client/registerCapability` 直接应答）；按 `shutdown` → `exit` 顺序关闭。
- [x] **T3 DocumentStore。** 版本号与哈希，`syncFromDisk(file)`，按扩展名取 languageId，打开文档最多 200 个（LRU 发 `didClose`）。
- [x] **T4 DiagnosticsStore。** 推送缓存按保存代数标记、等待者、150ms 稳定判定、返回带状态的 `DiagnosticsSnapshot`。可以吸收 `lsp-diagnostics-adapter.ts` 里的代数和等待者逻辑。
- [x] **T5 ClientPool + Manager + TS 预设。**
  - 实现租约、空闲关闭、全局上限、崩溃退避和 `status()`。
  - TS 预设的根标记是 `tsconfig.json` / `jsconfig.json` / `package.json`，覆盖 `.ts/.tsx/.js/.jsx/.mts/.cts/.mjs/.cjs`。
  - 在 `server/src/index.ts` 的 `shutdown` 里调用 `manager.dispose()`。
- [x] **T6 写后诊断接线。**
  - facade 提供 `WriteDiagnosticsProvider` 与 `FileChangeNotifier`，取代 `createLspDiagnosticsAdapter` 自带 transport 的路径。旧 adapter 删除，有用的测试迁到 T4。
  - 在 `server-state` 里构造 manager，经 RunOptions 传到 `buildEffectiveToolOptions`；run 开始时获取租约。
  - `buildMutationResultText` 增加诊断小节，输出模型可见的文本：
    - 有新错误：`New errors introduced by this edit (N): path:line:col message`
    - 服务器未就绪：`Diagnostics not checked: TypeScript server still starting`
    - 没有新错误：一行 `No new errors.`
  - 预算：服务器已就绪时最多等 3s；正在启动时立即返回 pending，不阻塞编辑。`details.lifecycle` 照旧保留给界面。
- [x] **T7 测试。**
  - 单元测试：用 `vscode-jsonrpc` 的内存流做假服务器，覆盖初始化、同步、诊断稳定、pending、只报新增错误、租约与空闲关闭、崩溃退避。
  - 集成测试：用随包的 `typescript-language-server` 在临时 TS 项目里写入一个类型错误，断言编辑结果文本里出现该错误。

**P0 验收：** 在 zclaudia 仓库里让 Pi agent 故意改出一个类型错误，工具结果里能看到这个错误；修好后显示 `No new errors.`；Debug 页的 Managed processes 里能看到 `language_server` 进程，run 结束 10 分钟后进程退出。

**P0 实施记录（2026-10-04，分支 `feat/lsp-manager`）：**

- **T1 验证结论：**
  - `typescript-language-server@5.3.0` 是单个无依赖的 `lib/cli.mjs`，打包后 vendor 目录约 916K；sidecar node 22.20.0 能直接运行它。bundle 里的 `server.mjs` 按 `vendor/typescript-language-server/lib/cli.mjs` 查找，路径已核对。
  - **它没有自带 TypeScript**：查找顺序是 `tsserver.path` → 工作区 `node_modules/typescript` → 自身旁边的 `typescript`（发布包里不存在）。因此探测条件是"项目里能找到 `typescript`"，并通过 `initializationOptions.tsserver.path` 把探测到的那一份钉住。
  - **pnpm monorepo 根目录没有 `node_modules/typescript`**（zclaudia 本仓就是这样），所以探测先向上找，找不到再向下查工作区包两层，在本仓用时 0.3ms。
  - macOS `.app` 实机冒烟仍待手动做。
- **T6 实现：**
  - 诊断以 `WriteDiagnosticsReport` 的形式写进 Write/Edit 返回给模型的文本，`details.lifecycle` 照旧保留给界面。
  - 首次见到某个文件时，先用 `originalContent` 诊断旧内容得到基线；新建文件的基线为空。
  - 旧的 `lsp-diagnostics-adapter.ts` 已删除。多文件 patch 路径本来就不跑诊断，保持原样。
- **T7 测试：**
  - 单元测试：用内存流跑真实 JSON-RPC 的假服务器，覆盖 diagnostics、documents、manager、facade。
  - 真服务器集成测试：`typescript.integration.test.ts`。
  - 端到端：`e2e/tests/agent-runtimes/lsp-diagnostics.playwright.spec.ts`。真实 server、真实工具，只把模型换成脚本；断言模型收到的 Write 结果里有新引入的错误，同时断言 Debug 进程列表里出现 `language_server` 进程。
- **已知行为：** 新 run 的第一轮如果立刻编辑（比 server 启动还快），只会报"not checked, still starting"，这是按设计不阻塞写入。端到端测试为此先跑一轮预热。

## P1：打开 LSPTool

- [ ] **T8 扩展端口契约。**
  - 在 `language-server-port.ts` 注明列号单位是 UTF-16。
  - `LspLocation` 增加 `external?: true`：工作区外的结果保留绝对路径，不再强行转成相对路径。
  - 诊断结果带 `state`。
  - 新增 `incomingCalls` 动作，仅在服务器支持 callHierarchy 时开放。
- [ ] **T9 LSPTool 改为符号寻址。**
  - 参数改为 `file + line + symbol`（加可选的 `occurrence`），工具在该行里定位列号；`character` 保留作后备。
  - 查询前从磁盘同步。
  - 每个结果附一行预览，减少模型为看上下文再调用 Read。
- [ ] **T10 接线。**
  - 在 `server-state` 里把 manager 的 `LanguageServerPort` facade 传入 RunOptions。现有门控（`tool-bridge.ts`：`serversFor` 为空就不注册）保持不变。
  - 服务器首次启动时等待最多 20s，超时返回结构化错误 `server_starting` 并提示稍后重试，不要一直挂到 30s 工具超时。
- [ ] **T11 核对 Read 能否打开外部路径。** 跳转定义经常落到 `node_modules` 或 `lib.d.ts`。如果 Read 只允许工作区内路径，就靠 T9 的预览行兜底，或者为外部结果单独放开只读访问。二选一，并写进工具描述。
- [ ] **T12 测试。** 符号寻址（同一行多次出现、找不到、多字节字符）、外部路径、Bash 修改后查询能拿到新内容、`server_starting` 错误。

**P1 验收：** agent 能对 zclaudia 仓库里的符号做 definition / references / hover / symbols / incomingCalls 查询，结果正确，且反映 Bash 改动后的最新内容。

## P2：更多语言 + 可见性

- [ ] **T13 预设扩展。** `pyright-langserver --stdio`、`gopls`、`rust-analyzer`，只在 PATH 上探测；探测结果异步刷新、TTL 60s，保证 `serversFor` 始终同步且廉价。
- [ ] **T14 状态 API + Debug 小节。**
  - 新增 `GET /api/debug/language-servers`：返回服务器、状态、租约数、打开文档数、最近错误。
  - 在 Debug 页加一个小节显示这些信息，界面文案用英文。
- [ ] **T15 总开关。** 设置里加 LSP 总开关，默认开启，关闭后 `serversFor` 恒为空。
- [ ] **T16 测试 + 文档。** 预设探测单元测试；`CLAUDE.md` / `docs/` 补充 LSP 一节（预设、上限、开关）。

## P3（不在本计划范围）

- 插件 `contributes.lspServers` 与项目配置 `.zclaudia/lsp.json`，二者都要做信任确认。
- 托管安装：扩展 managed runtime 机制以支持 npm 包，或只覆盖 rust-analyzer 这类单二进制服务器；还要解决"预设写在 host，但下载元数据不能写在 host"的冲突。
- `rename` 写操作工具：通过现有编辑管线应用 WorkspaceEdit，保持 diff、备份、已读文件状态一致。
- 桌面端使用方：最先做文件查看器标出诊断；悬停和跳转需要先把查看器换成 CodeMirror。

## 风险

- **内存。** 大仓库里单个 tsserver 可达 1GB 以上，worktree 子代理会成倍放大。由全局上限与 LRU 淘汰兜底，上限值在 P0 冒烟时按实测调整。
- **噪音。** 只报新增错误的比较依赖 message 稳定；若某些服务器的 message 里带行号，会误判为新增。P2 加更多语言时逐个确认。
- **Windows 路径与 URI。** 沿用 `filePathToUri`（`pathToFileURL`），T7 加 Windows 风格路径用例。
