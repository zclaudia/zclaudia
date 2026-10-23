# P6 图片与视频能力 — 实现设计

日期：2026-10-24。状态：设计定稿，T0 契约由主代理预落，L30–L36 由 flash 子代理（luna）分波实现、主代理逐波验收。上游计划：[分阶段实施计划](2026-10-23-design-workbench-implementation-plan.md) 的 P6 章节；基线见 [P1](2026-10-23-design-workbench-p1-implementation.md)、[P2](2026-10-23-design-workbench-p2-implementation.md)、[P3](2026-10-23-design-workbench-p3-implementation.md)、[P4](2026-10-23-design-workbench-p4-implementation.md)、[P5](2026-10-23-design-workbench-p5-implementation.md)。

本批覆盖 **P6.1 媒体任务接口 / P6.2 图片生成与编辑 / P6.3 模型与费用体验 / P6.4 动效与视频验证 / P6.5 媒体交付**。图片与视频同批实施、波次并行（L32 视频与 L30/L31 图片并行），符合上游「图片先、视频单独交付」的顺序：视频链路的真实 Chrome/ffmpeg 冒烟独立成档（§12）。

明确排除（第一版边界）：

- **不接入全局 tasks 表**（决策见 §0.2）：媒体任务自建 design 域存储（migration 051），不新增 wire 消息、不改 task-settlement-notifier、不进任务中心；进度经既有 HTTP 轮询。
- **不新建凭据存储**（§0.3）：图片服务凭据复用 llm_profiles（OpenAI 兼容 baseUrl+apiKey+requestHeaders），媒体端点只返回 `hasCredential` 布尔，绝不返回密钥材料。
- **首个（也是本批唯一）provider = `openai-images`**：OpenAI 兼容 `POST {base}/images/generations` 与 `POST {base}/images/edits`，覆盖 `https://api.openai.com/v1` 与 `https://open.bigmodel.cn/api/paas/v4`（CogView）等。其余 provider 为后续独立扩展，接口已留位。
- **视频 v1 无音频轨**（§4.6）：Chromium 标签页系统音频采集平台相关（loopback/虚拟设备）不可复现，`--mute-audio`，MP4 无音轨，界面与文档明示。
- **视频帧捕获为墙钟 screencast，非帧确定渲染**（§4.5）：可复现指「同一路线/依赖/参数在任何机器上可重跑」，不承诺逐帧与浏览器实时呈现逐位一致。
- **生成的图片不自动建快照**：被页面引用并保存后自然进入 P1 快照与 P2 导出（§5.3）；媒体任务自身只落素材文件与任务记录。
- **客户端视频预览经 fetch→blob 内存组装**（上限 256 MiB 内，§5.2），不做分段 Range 播放器。
- **真实付费服务（CogView/OpenAI）生成冒烟为用户手工门槛**（§12）；自动化测试全部使用注入的假 fetch / 假执行器，不以 mock 成功代表真实服务可用（上游验收口径）。

## 0. 已定决策（主代理勘察，2026-10-24）

1. **媒体任务 = design 域新服务 + 自建表。** P6.1「复用已有任务和进程生命周期」的落地方式：任务生命周期语义（状态机、事件化转移、去重、取消、重启收尾）对齐既有 TaskService 词汇，**进程生命周期直接复用**（视频渲染进程走 detached spawn + `killProcessTree`，即 CommandTaskExecutor 模板）；但不把媒体任务写入全局 `tasks` 表——全局表为 Agent/command 任务优化（wire 推送、executor 注册、CHECK 约束迁移），媒体任务需要工作区归属、富进度（phase/frames/usage）、设计面板内消费，硬接全局域的改动面（migration 018 式拓宽 + notifier 过滤 + 客户端 store 扩展）远大于收益。设计域已有自建表先例（migration 050 快照三表）。
2. **进度 = HTTP 轮询。** 面板已有 2s 轮询模式（P2 deps stat、P4 agent-run-watch），媒体任务列表轮询 2s（仅面板打开时），不新增推送通道。
3. **图片凭据 = llm_profiles。** `providerType: 'openai'` 的 profile 携带 baseUrl（缺省 `https://api.openai.com/v1`）+ apiKey + requestHeaders；服务端经 `LlmProfileRepository`（`findById`/`findAllOrdered`）读取，URL 拼接与鉴权头对齐 `models-fetch.ts` 惯例。不保存密钥到任何设计文件 ✓（P6.2）。
4. **产物落地复用素材写入语义。** 图片走 `DesignService.importAsset`（重名 `-2/-3` 去重、永不覆盖、≤10 MiB、`safeWriteFile`）；视频走媒体服务内 `writeGeneratedAsset`（同重命名循环 + `safeWriteFile`，上限 256 MiB）。「生成失败不替换原素材」由「永不覆盖」语义直接保证 ✓（P6.5）。
5. **视频路线 = 服务端 puppeteer-core（既有依赖）+ Chrome（既有 `resolveChromePath`/engine cache）+ 系统 ffmpeg（无新 npm 依赖）。** 帧捕获 `page.startScreencast`（JPEG），编码 ffmpeg stdin `image2pipe` → stdout 分片 MP4（libx264/yuv420p/`frag_keyframe+empty_moov`），CFR 归一。ffmpeg 发现：`FFMPEG_PATH` env → PATH → 常见 brew 路径；缺失任务失败 `RUNTIME_MISSING` 并给出安装提示。取消 = 停 screencast + 关浏览器 + `killProcessTree(ffmpeg)`，等进程退出后置 cancelled ✓（P6.4「任务取消后相关进程退出」）。
6. **重试 = 显式确认后新建任务**（客户端复用 params 再提交），提交前对话框明示「将重新提交生成请求，可能产生费用」；并发去重（同工作区同参数在跑 → 409）防无提示重复提交 ✓（P6.3）。
7. **服务端零改动不成立**：本批新增 migration 051、服务端媒体模块与路由扩展；但**不触碰** pi-runtime、conversation、tasks 域与既有 design 端点行为。桌面新模块：`media-task-client.ts`、`components/MediaGenPanel.tsx` + api.ts 媒体分节（T0 预落）。

## 1. P6.1 媒体任务接口（`media-types.ts` 契约 + `media-task-service.ts`）

### 1.1 任务模型（migration `051_design_media_tasks`，T0 预落）

```sql
CREATE TABLE IF NOT EXISTS design_media_tasks (
  id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,        -- fs.realpath 的规范工作区根（归属键）
  session_id TEXT NOT NULL,            -- 提交会话（展示与授权用）
  kind TEXT NOT NULL,                  -- image-generate | image-edit | video-render
  status TEXT NOT NULL,                -- queued | running | completed | failed | cancelled
  params_json TEXT NOT NULL,
  provider_json TEXT,                  -- {providerId, profileId, profileName, model} | null
  progress_json TEXT,                  -- {phase, detail?, frames?} | null
  result_json TEXT,                    -- {path, bytes, mime, usage} | null
  error_code TEXT,
  error_message TEXT,
  dedup_key TEXT NOT NULL,             -- sha256(kind + 规范化 params + providerId/model)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_design_media_tasks_ws
  ON design_media_tasks(workspace_root, created_at);
CREATE INDEX IF NOT EXISTS idx_design_media_tasks_active
  ON design_media_tasks(workspace_root, dedup_key, status);
```

- **归属**：任务按 `workspace_root` 归属；同工作区任意会话可见同一列表（与 P2 工作区身份口径一致），跨 worktree 隔离。
- **状态机**：`queued → running → completed|failed`；`queued|running → cancelled`；终态不可再转移。每次转移更新 `updated_at`。
- **去重**：`create` 时若同 `workspace_root` + `dedup_key` 存在 `queued|running` 行 → 409 `MEDIA_TASK_ACTIVE_EXISTS`。
- **并发上限**：image 类（generate+edit 合计）2、video 1；超出的任务保持 `queued`，由调度器（`tryDispatch`）在任务终态后依 `created_at` 顺序拉起。
- **保留**：每工作区保留最近 100 条，`create` 时裁剪更旧行。
- **重启收尾**：`MediaTaskService` 构造时把遗留 `queued|running` 行置 `failed`（`error_code='INTERRUPTED'`，消息「服务重启导致任务中断」），并 abort 内存中的活动执行（若有）。

### 1.2 执行器契约（`media-types.ts`，T0 预落）

```ts
export interface MediaExecutorContext {
  signal: AbortSignal; // cancel 已请求
  onProgress(update: DesignMediaProgress): Promise<void>;
  workspaceRoot: string; // 服务端已 realpath 的工作区根
  resolveWorkspacePath(relativePath: string): Promise<string>; // 经 design resolve() containment
}
export interface MediaTaskExecution {
  id: string;
  kind: DesignMediaTaskKind;
  params: DesignMediaTaskParams; // §1.3 规范化后的参数
  provider: DesignMediaProviderRef | null; // image 类必有；video null
}
export type MediaTaskExecutor = (
  execution: MediaTaskExecution,
  ctx: MediaExecutorContext
) => Promise<DesignMediaTaskResult>;
export type MediaTaskExecutors = Partial<Record<DesignMediaTaskKind, MediaTaskExecutor>>;
```

- 执行器抛错收口：`MediaTaskRunError`（media-types 预落，`code` 携带任务级错误码）→ `failed{code,message}`；执行器抛其他异常 → `failed{code:'INTERNAL'}`；catch 后 `ctx.signal.aborted === true` → 一律 `cancelled`（无论抛什么）。
- 任务级错误码：`INTERRUPTED`、`RUNTIME_MISSING`（Chrome/ffmpeg 不可用）、`ENTRY_UNREADABLE`（视频入口不存在/不可读）、`RENDER_FAILED`、`ENCODE_FAILED`（含输出超 256 MiB、零帧）、`PROVIDER_ERROR`、`PROVIDER_UNSUPPORTED`、`PROVIDER_TIMEOUT`、`ABORTED`（映射自 `MediaProviderError`）、`ASSET_WRITE_FAILED`（素材写入失败）。HTTP 层错误码（请求形状）：`MEDIA_VALIDATION`(400)、`MEDIA_TASK_NOT_FOUND`(404)、`MEDIA_TASK_ACTIVE_EXISTS`(409)、`MEDIA_TASK_INVALID_STATE`(409)、`MEDIA_CONFIG_MISSING`(400，无可用 openai profile 之外的配置类错误)。

### 1.3 参数规范化（`create` 入参校验，服务端权威）

```ts
// image-generate
{ sessionId; kind: 'image-generate'; provider: { profileId: string; model: string };
  prompt: string;                      // trim 后 1..4000
  size?: string;                       // /^\d{2,4}x\d{2,4}$/，缺省由服务方决定
  targetDir?: string }                 // 缺省 'design/assets'（导入默认）
// image-edit：同上 + sourcePath（必填，工作区相对，须为可读图片 ≤10 MiB）
// video-render
{ sessionId; kind: 'video-render';
  entryPath: string;                   // 工作区相对 HTML 入口
  width: number; height: number;       // 320..1920，且为偶数（yuv420p）
  fps: number;                         // 8..60
  durationMs: number }                 // 500..60000
```

`model` trim 后 1..100；`profileId` 非空字符串。规范化后（含缺省值）写入 `params_json`，`dedup_key` 由规范化参数 + providerId/model 计算。

### 1.4 服务接口（L31）

```ts
export class MediaTaskService {
  constructor(db: Database, designService: DesignService, executors: MediaTaskExecutors);
  create(sessionId: unknown, input: unknown): Promise<DesignMediaTaskSummary>;
  list(sessionId: unknown, limit?: unknown): Promise<DesignMediaTaskSummary[]>; // 缺省 50，≤200
  cancel(sessionId: unknown, taskId: unknown): Promise<DesignMediaTaskSummary>; // 终态 → 409
  /** 结果下载目标（completed 任务的产物文件绝对路径 + 文件名 + mime，供路由流式回传）。 */
  resultTarget(
    sessionId: unknown,
    taskId: unknown
  ): Promise<{
    absolutePath: string;
    fileName: string;
    mime: string;
    bytes: number;
  }>;
}
```

- `create` 流程：workspace 解析（`designService.workspace(sessionId)`）→ 参数校验/规范化 → profile 名解析（经注入的 `resolveProfileName(profileId)`，见 L33 接线；解析不到 → 400 `MEDIA_VALIDATION`「指定的服务配置不存在」）→ 去重检查 → insert `queued` → `tryDispatch()`（不 await 执行体）→ 返回 summary。
- `cancel`：queued → 直接置 cancelled；running → abort 该任务的 AbortController，等执行体收尾（状态由收尾路径写入，cancel 响应返回当前快照）；终态 → 409 `MEDIA_TASK_INVALID_STATE`。
- 进度持久化：执行器 `onProgress` → `UPDATE progress_json, updated_at`（失败静默，不中断执行）。
- **取消时已写入产物的语义**：文件已落素材库则保留（新文件、未覆盖任何原素材），任务置 cancelled 且 `result_json` 保留；文档与 UI 声明。

### 1.5 图片执行器工厂（L31 内导出，供 L33 组装）

```ts
export function createImageTaskExecutor(deps: {
  designService: DesignService;
  /** 由 provider ref 构造具体 provider（L33 注入 openai-images 实现；L31 测试注入假 provider）。 */
  makeProvider: (ref: DesignMediaProviderRef) => Promise<MediaImageProvider>;
}): MediaTaskExecutor;
```

流程（image-generate / image-edit 共用）：`submitting` → image-edit 时经 `designService.readAsset` 读源图（>10 MiB / 非图片 → `failed ASSET_WRITE_FAILED` 前置校验失败，错误码用 `PROVIDER_ERROR` 之外的 `ENTRY_UNREADABLE`）→ `generating`（调 provider；MediaProviderError 映射 §1.2 码表）→（url 下载型）`downloading` → `saving`：文件名 `gen-<slug>-<YYYYMMDD-HHmmss>.<ext>`（slug = prompt 小写、非字母数字折叠为 `-`、截 24 字符、空则 `image`；ext 由 magic bytes 定 png/jpg/webp）→ `designService.importAsset(sessionId, fileName, base64, targetDir)` → 返回 `{path, bytes, mime, usage}`。

## 2. P6.2 图片 provider（`media-image-provider.ts`，L30）

### 2.1 契约（media-types.ts 预落）

```ts
export type MediaImageCapability = 'generate' | 'edit';
export interface MediaImageProviderInfo { id: string; label: string; capabilities: MediaImageCapability[] }
export type MediaProviderErrorCode = 'provider-error' | 'provider-unsupported' | 'provider-timeout' | 'provider-aborted';
export class MediaProviderError extends Error {
  constructor(readonly code: MediaProviderErrorCode, message: string, readonly status?: number);
}
export interface MediaImageSource { path: string; mime: string; bytes: Buffer }
export interface MediaImageResult { bytes: Buffer; mime: 'image/png' | 'image/jpeg' | 'image/webp'; usage: DesignMediaUsage | null }
export interface MediaImageProvider {
  readonly info: MediaImageProviderInfo;
  generate(input: { prompt: string; size?: string; signal: AbortSignal }): Promise<MediaImageResult>;
  edit(input: { prompt: string; size?: string; source: MediaImageSource; signal: AbortSignal }): Promise<MediaImageResult>;
}
```

`DesignMediaUsage = { inputTokens?: number; outputTokens?: number; totalCostUsd?: number }`（OpenAI `usage.input_tokens/output_tokens/total_cost` 归一；服务未返回 → `null`，UI 显示「费用未知」）。

### 2.2 `OpenAiImagesProvider`（L30）

```ts
export function createOpenAiImagesProvider(config: {
  baseUrl?: string; // 缺省 https://api.openai.com/v1，尾斜杠剥离后拼接
  apiKey: string; // 空 → 构造期不报错，调用期抛 provider-error？否：401 归 provider-error
  requestHeaders?: Record<string, string>;
  fetchImpl?: typeof fetch; // 注入测试；缺省 globalThis.fetch
  timeoutMs?: number; // 缺省 180_000
}): MediaImageProvider; // info = { id: 'openai-images', label: 'OpenAI 兼容图片服务',
//        capabilities: ['generate', 'edit'] }
```

- **generate**：`POST {base}/images/generations`，JSON `{ model, prompt, n: 1 }`（`size` 有则带上；**不发送 `response_format`**——gpt-image-1 拒绝该参数，CogView 亦不依赖；响应两种形态都处理）。头：`Authorization: Bearer` + `requestHeaders`。
- **edit**：`POST {base}/images/edits`，multipart `FormData`（`model`、`prompt`、`size`?、`image` = Blob(source.bytes, {type: source.mime})）。上游 404/405 → `provider-unsupported`（消息「当前服务不支持图片编辑」）。
- **响应**：`data[0].b64_json` 优先；否则 `data[0].url` → 下载（`downloading` 阶段）：仅 `https:`、拒绝 hostname 为 `localhost`/`*.local`/回环与私网字面量（`127.`、`10.`、`192.168.`、`169.254.`、`172.16-31.`、`::1`、`0.0.0.0`），下载超时 60s、上限 10 MiB。`usage` 字段存在且含已知键则归一，否则 `null`。
- **magic bytes**：PNG `89 50 4E 47`、JPEG `FF D8 FF`、WebP `RIFF…WEBP`（前 4 + 8..12）→ mime + ext；不识别 → `provider-error`「服务返回了无法识别的图片格式」。
- **错误映射**：非 2xx → 读 body 前 200 字符入消息，`provider-error(status)`；404/405 仅在 edit 路径映射 `provider-unsupported`；网络异常 → `provider-error`；`AbortSignal.timeout` 型超时 → `provider-timeout`；外部 signal 中止 → `provider-aborted`。超时与外部中止的组合：以「外部 signal 先中止 → provider-aborted」优先（cancel 语义）。

## 3. P6.3 模型与费用体验

- **任务记录快照所选服务**：`provider_json = {providerId, profileId, profileName, model}`（提交时解析定稿），任务列表 UI 展示「服务：<profileName> · <model>」；profile 事后改名/删除不影响历史任务展示 ✓。
- **用量**：服务返回 `usage` → 归一化存储并在结果卡展示（tokens / totalCostUsd）；未返回 → 「费用未知（服务未返回用量）」。**不做任何估算报价**（无本地价目表，避免过期价格误导）✓（上游「不能精确报价时明确表示估算或未知」取「未知」侧）。
- **重试**：客户端「重试」按钮 → 确认对话框（「将重新提交生成请求，可能产生费用。继续？」）→ 以原 params 新建任务。进行中任务的重复提交被 §1.1 去重拦截 ✓。

## 4. P6.4 动效与视频渲染（`video-render-service.ts`，L32）

### 4.1 决策：渲染路线

服务端 headless Chromium（`puppeteer-core` 既有依赖 + 既有 Chrome 发现/安装基础设施 `resolveChromePath`/`defaultChromeDiscoveryDeps`，engine cache 目录与 browser 域同源）驱动工作区 HTML 页面，`Page.screencast`（JPEG q90）按墙钟采集 `durationMs`，帧流经 stdin 喂系统 ffmpeg（`image2pipe`，无新 npm 依赖），CFR 编码为 H.264 yuv420p 分片 MP4（stdout 收集）。**HyperFrames 适配不在本批**（上游 P6.4 措辞「再决定是否迁移」；本批结论：路线可行即作为独立扩展另立项）。

### 4.2 注入边界（可测性核心）

```ts
export interface VideoRenderDeps {
  launchBrowser(): Promise<RenderBrowser>;
  resolveFfmpeg(): Promise<string | null>;
  spawnFfmpeg(args: string[], opts: { onStderr?: (chunk: string) => void }): EncoderProcess;
  killTree(pid: number): Promise<void>;
}
export interface RenderBrowser {
  openPage(url: string, viewport: { width: number; height: number }): Promise<RenderPage>;
  close(): Promise<void>;
}
export interface RenderPage {
  startScreencast(onFrame: (jpeg: Buffer) => void): Promise<void>;
  stopScreencast(): Promise<void>;
  close(): Promise<void>;
}
export interface EncoderProcess {
  pid: number;
  writeStdin(chunk: Buffer): Promise<void>; // 内建背压（false → await drain）
  endStdin(): void;
  /** stdout MP4 字节（编码完成时 resolve）；stderrTail 截尾 2 KiB。 */
  wait(): Promise<{ code: number | null; stdout: Buffer; stderrTail: string }>;
}
export function createVideoRenderExecutor(deps?: VideoRenderDeps): MediaTaskExecutor; // 缺省真依赖
export function resolveFfmpegPath(env: NodeJS.ProcessEnv): Promise<string | null>; // 供依赖与诊断
```

默认实现：`launchBrowser` 动态 `import('puppeteer-core')` + `resolveChromePath(defaultChromeDiscoveryDeps(<browser 域同款 cacheDir>))`（null → `MediaTaskRunError('RUNTIME_MISSING', '未找到可用的 Chrome/Chromium…')`），launch 参数 `headless: true`、`args: ['--mute-audio', '--disable-dev-shm-usage']`；`spawnFfmpeg` = `child_process.spawn(ffmpeg, args, { detached: true, stdio: ['pipe','pipe','pipe'] })`（detached 供 `killProcessTree` 进程组击杀）；`killTree` = `utils/process-tree.ts` 的 `killProcessTree`。

### 4.3 ffmpeg 参数与输出

```
ffmpeg -y -f image2pipe -framerate <fps> -i pipe:0 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -an \
  -movflags frag_keyframe+empty_moov -f mp4 pipe:1
```

stdout 收集上限 256 MiB（超限 → kill + `ENCODE_FAILED`「输出超过大小上限」）；退出码非 0 → `ENCODE_FAILED`（消息含 stderrTail 摘要）；**零帧**（screencast 一帧未发）→ `RENDER_FAILED`「页面没有产生任何画面帧」。

### 4.4 编排（executor 主体）

1. 校验参数（§1.3 上限之外补充：width/height 偶数）→ `launching`。
2. `resolveWorkspacePath(entryPath)` + stat（缺失/非常规文件 → `ENTRY_UNREADABLE`）。
3. `resolveFfmpeg`（null → `RUNTIME_MISSING`「未找到 ffmpeg。请安装 ffmpeg（如 brew install ffmpeg）或设置 FFMPEG_PATH」）。
4. spawn encoder → launch browser → `page = openPage(file://<entry>, viewport)`（waitUntil `load` + 300ms 稳定等待）。
5. `rendering`：`startScreencast`，帧循环写 stdin（每帧检查 `signal.aborted`；每帧或每秒 `onProgress({phase:'rendering', frames:N})`），墙钟到 `durationMs` 停。
6. 停 screencast、关 page/browser → `endStdin` → `encoding`：`await wait()`。
7. `saving`：`writeGeneratedAsset(sessionId?, 'render-<entrySlug>-<ts>.mp4', stdout, 'video/mp4')`（§5.1）→ 返回 result。

**取消路径**：任意步骤见 `signal.aborted` → 停 screencast、关浏览器、`killTree(encoder.pid)`、await wait()（忽略结果）→ 抛 `MediaTaskRunError('ABORTED','已取消')`；L31 收尾判 `signal.aborted` 置 `cancelled` ✓「任务取消后相关进程退出」。

### 4.5 可复现性与帧语义（已知边界）

screencast 帧率随合成器与页面动画复杂度波动；ffmpeg `-framerate` 做恒定帧率化（不足补帧、过密丢帧）。同参数同依赖在任何 macOS/Linux 上可重跑同一路线；不承诺与浏览器实时呈现逐帧一致、不承诺两次渲染字节一致。界面文案「动效渲染（近似实时采集）」。

### 4.6 音频（已验证结论）

Chromium 无头模式下标签页音频采集需要平台级 loopback（macOS ScreenCaptureKit/虚拟设备、Linux PulseAudio monitor），不可移植且不稳定；v1 `--mute-audio`、MP4 无音轨。此为上游 P6.4「音频」维度的**验证结论：暂不支持**，非静默缺失（UI/文档标注）。

## 5. P6.5 媒体交付

### 5.1 产物写入（服务端）

- **图片**：`importAsset`（≤10 MiB、白名单、`-2/-3` 去重、`safeWriteFile`、symlink containment）——生成链路即导入链路，天然满足「失败不替换原素材」。
- **视频**：L31 `writeGeneratedAsset(sessionId, fileName, bytes, mime)`：`targetDir = 'design/assets'`，重命名循环与 `importAsset` 同款（`fs.lstat` 探测 + `-2/-3` 候选 ≤100），`mkdir -p` + realpath(parent) containment + `safeWriteFile(absolute, bytes, { maxBytes: 256 MiB, expectedRevision: '', createIfMissing: true })`。文件名校验同 `validateAssetFileName` 口径（扩展名白名单加 `.mp4/.webm`，见 L35）。

### 5.2 传输

- **任务结果下载**：`GET /api/design/media-tasks/:id/result` → `fs.createReadStream(absolutePath).pipe(res)`，头 `Content-Type: <mime>` + `Content-Disposition: attachment; filename="…"`（zip 导出同款二进制直传形态，不经 base64 JSON）✓「大文件流式」。客户端 `downloadDesignMediaTaskResult` → `{blob, filename}`（内存组装，≤256 MiB 边界文档声明）。
- **图片缩略图**：沿用 `GET /api/design/asset` base64（≤10 MiB）。
- **上传侧无新增**：image-edit 源图在服务端工作区内读取；无客户端大文件上传。

### 5.3 历史与导出清单（L35）

- `resource-graph.ts` `kindForPath` 扩展 `video`（`.mp4/.webm/.mov`）；快照 `SnapshotFileKind` 加 `'video'`。**快照单文件上限 10 MiB 不放宽**：视频超限进 skipped/incomplete 清单（既有机制），不谎称完整快照；HTML 引用的 `<video src>` / `<source src>` 已被资源图收集，ZIP 导出随之携带（kind 标 `video`）。
- `listAssets` kinds 扩 `'video'`（`.mp4/.webm/.mov` 扩展集）；`ASSET_TYPES` 补 mp4/webp 已有、mp4/webm MIME。素材库 UI 加视频 tab（列清单 + 体积，无缩略图、不支持客户端导入——大于 10 MiB 的视频导入无意义，生成是主通路）。
- 生成图片被页面引用并保存后，自然进入 P1 快照与 P2 ZIP 导出（image kind 既有链路）；任务不自动建快照（§0.4）。

## 6. HTTP API（L33 扩展 `interfaces/http/design.ts`）

路由工厂签名扩为 `createDesignRoutes(db, mediaDeps?: DesignMediaRoutesDeps)`（缺省真装配；测试注入假 executors/provider/profiles）：

| 方法+路径                                          | 请求 → 响应                                                                                                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/design/media/providers`                  | → `{ providers: MediaImageProviderInfo[]; profiles: {id,name,providerType,hasCredential}[] }`（仅 `providerType==='openai'` 的 profile；`hasCredential = Boolean(apiKey)`；不返回密钥） |
| POST `/api/design/media-tasks`                     | body §1.3 → `DesignMediaTaskSummary`                                                                                                                                                    |
| GET `/api/design/media-tasks?sessionId&limit`      | → `{ tasks: DesignMediaTaskSummary[] }`（newest first）                                                                                                                                 |
| POST `/api/design/media-tasks/:id/cancel`          | body `{sessionId}` → `DesignMediaTaskSummary`                                                                                                                                           |
| GET `/api/design/media-tasks/:id/result?sessionId` | → 二进制流（§5.2；非 completed → 409 `MEDIA_TASK_INVALID_STATE`）                                                                                                                       |

`DesignMediaTaskSummary`（wire 形态，T0 同步落桌面 api.ts）：

```ts
export interface DesignMediaTaskSummary {
  id: string;
  kind: DesignMediaTaskKind;
  status: DesignMediaTaskStatus;
  createdAt: number;
  updatedAt: number;
  provider: { providerId: string; profileId: string; profileName: string; model: string } | null;
  params: DesignMediaTaskParams;
  progress: { phase: DesignMediaPhase; detail?: string; frames?: number } | null;
  result: { path: string; bytes: number; mime: string; usage: DesignMediaUsage | null } | null;
  error: { code: string; message: string } | null;
}
```

真装配（L33）：`imageExec = createImageTaskExecutor({ designService, makeProvider: ref → profile 凭据 → createOpenAiImagesProvider })`；`videoExec = createVideoRenderExecutor()`；`resolveProfileName/profileCredentials` 经 `LlmProfileRepository`（`findAllOrdered`/`findById`）。

## 7. 桌面客户端契约（T0 预落 `api.ts` 媒体分节）

```ts
export type DesignMediaTaskKind = 'image-generate' | 'image-edit' | 'video-render';
export type DesignMediaTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type DesignMediaPhase =
  | 'submitting'
  | 'generating'
  | 'downloading'
  | 'saving'
  | 'launching'
  | 'rendering'
  | 'encoding';
// + DesignMediaProgress / DesignMediaUsage / DesignMediaProviderRef / DesignMediaTaskParams（§1.3 镜像）
// + DesignMediaTaskSummary（§6 同款）与错误类复用 DesignHttpError

export function createDesignMediaTask(
  backendId,
  input: ImageCreate | VideoCreate
): Promise<DesignMediaTaskSummary>;
export function listDesignMediaTasks(
  backendId,
  sessionId,
  limit?
): Promise<{ tasks: DesignMediaTaskSummary[] }>;
export function cancelDesignMediaTask(
  backendId,
  input: { sessionId; taskId }
): Promise<DesignMediaTaskSummary>;
export function listDesignMediaProviders(backendId): Promise<{
  providers: { id: string; label: string; capabilities: ('generate' | 'edit')[] }[];
  profiles: { id: string; name: string; providerType: string; hasCredential: boolean }[];
}>;
export async function downloadDesignMediaTaskResult(
  backendId,
  sessionId,
  taskId
): Promise<{ blob: Blob; filename: string }>;
```

`listDesignAssets` 的 `kinds` 参数类型扩为 `'image' | 'font' | 'video' | 'all'`（服务端 L35 跟进）。`exportDesignZip` 的直连 fetch 模式复用到 `downloadDesignMediaTaskResult`。

## 8. 桌面 UI（L34 组件 + L36 接线）

### 8.1 `media-task-client.ts`（L34）

```ts
export interface UseMediaTasksOptions { backendId: string; sessionId: string | null; enabled: boolean }
export function useMediaTasks(options): {
  tasks: DesignMediaTaskSummary[]; loading: boolean; error: string | null;
  refresh: () => Promise<void>;
  submit: (input) => Promise<DesignMediaTaskSummary | { error: string }>;   // 含 409 去重错误转中文
  cancel: (taskId: string) => Promise<void>;
};
export function mediaPhaseLabel(phase: DesignMediaPhase): string;           // 中文：提交中/生成中/下载中/…
export function mediaStatusBadge(status: DesignMediaTaskStatus): string;    // 排队中/进行中/已完成/失败/已取消
export function mediaUsageLabel(usage: DesignMediaUsage | null): string;    // 「费用未知（服务未返回用量）」/ tokens/$
export function buildImageCreateInput(...): ImageCreate | { error: string }; // 纯校验（prompt 长度/size 格式/model 必填）
```

轮询：`enabled` 且面板挂载期间 2s 间隔 `listDesignMediaTasks`（存在 active 任务时；无 active 且最近一次刷新无变化可降频 5s——实现自便，测试按「active 存在时 2s」断言）；卸载清理。

### 8.2 `components/MediaGenPanel.tsx`（L34，Modal，props 全上抛）

```ts
interface MediaGenPanelProps {
  open: boolean;
  onClose: () => void;
  /** 工作区信息（无活动页也允许生成图片；视频 tab 需活动页）。 */
  sessionId: string | null;
  activeDocPath: string | null;
  /** 当前选区是否为可替换图片（img）；null = 无选区。 */
  imageSelection: { ready: boolean } | null;
  /** 替换选中图片 src（面板接 handleApply attribute 事务 + relativeAssetRef）。 */
  onReplaceSelectionSrc: (assetPath: string) => void;
  /** 产物落库后通知（面板 refreshNow + recentImports，P4 链路同款）。 */
  onAssetImported: (path: string) => void;
}
```

- **三 tab**：图片生成（prompt textarea、服务 select（profiles hasCredential）、model 输入 + datalist 建议 `cogview-4`/`gpt-image-1`/`dall-e-3`、size 输入、提交）、图片编辑（同上 + 源图选择：素材清单下拉，`listDesignAssets` image）、动效视频（entryPath（缺省 activeDocPath，无活动页禁用提交）、宽高（缺省 1280×720）、fps（缺省 30）、时长秒（缺省 5，0.5–60）、提交）。提交按钮在参数非法时禁用并给原因。
- **任务列表**（面板下半）：状态徽章 + 阶段文案（`mediaPhaseLabel`）+ 服务信息 + 用量/费用行 + 进行中「取消」+ 失败「重试」（确认对话框，§3 文案）+ 结果卡。图片结果卡：`getDesignAsset` base64 缩略图 + 路径 + 「替换选中图片」（`imageSelection.ready` 时可用，否则禁用 + title 说明）+「下载」。视频结果卡：`downloadDesignMediaTaskResult` → blob URL `<video controls>` 预览 + 「下载」（`saveBlobToFile`）。错误行展示 `error.message`。
- 409 去重错误显示「已有相同任务在进行中」；提交成功清空表单/聚焦任务列表。

### 8.3 接线（L36）

DesignToolbar「媒体」按钮（无需活动页，素材组旁）；DesignPanel `mediaOpen` state + 条件挂载 `MediaGenPanel`；`imageSelection = selection?.tagName === 'img' ? {ready:true} : {ready:false}`；`onReplaceSelectionSrc(path)` → `handleApply([{kind:'attribute', name:'src', value: relativeAssetRef(activeDocPath, path)}], '替换图片', …)`（AssetLibrary 替换链路同款）；`onAssetImported` → `recentImportsRef` + `refreshNow()`；切页关闭 Modal（P5 三对话框同款 effect 追加）。

## 9. 测试与任务卡

### 9.1 命令（各卡钉死，绝对路径）

```sh
# desktop（L34/L36）
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec vitest run --config vitest.ui.config.ts src/features/design
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec tsc --noEmit
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/desktop exec eslint src/features/design
# server（L30–L33/L35）
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/server exec vitest run src/application/design/__tests__ src/interfaces/http/__tests__/design.test.ts
bash /Users/zhvala/SourceCode/zclaudia/scripts/with-project-node.sh pnpm --filter @zclaudia/server exec tsc --noEmit
```

基线：desktop design 651 用例（37 文件）全绿；server design 115（8 文件）全绿；双端 tsc 0 错；desktop eslint 0 error / 30 warning 基线；`check-react-lifecycle-invariants` 与 `check-radius-conventions` 沿用。测试风格对齐既有：server 真临时目录 + `:memory:` SQLite + 真实 migration sql + supertest；desktop jsdom + `vi.mock('../api')` 全量桩。

### 9.2 T0（主代理，派发前）

本设计文档 + `migrations/051_design_media_tasks.ts`（+ index.ts 注册）+ `application/design/media-types.ts`（§1.2/§2.1 契约 + 常量 + `isDesignMediaTaskKind`/`MediaTaskRunError` 等纯定义）+ 桌面 `api.ts` 媒体分节（§7）。除此之外无共享契约文件改动。

### 9.3 Wave 1（并行 3，服务端纯模块）

- **L30 图片 provider**。新文件 `server/src/application/design/media-image-provider.ts` + `__tests__/media-image-provider.test.ts`。实现 §2 全部（仅依赖 media-types；fetch 注入）。测试：b64/url 两形态、magic bytes 三格式、非 2xx 映射、edit 404 → unsupported、超时 → provider-timeout、外部中止 → provider-aborted、私网 URL 拒绝、usage 归一与缺失、请求体形状（model/prompt/size/n=1、无 response_format；edit multipart 含 image）。**禁改：media-types.ts、design-service.ts、其他服务端与全部桌面文件。**
- **L31 媒体任务服务**。新文件 `media-task-service.ts` + `__tests__/media-task-service.test.ts`（假 executor/provider 注入）。实现 §1 全部 + §1.5 图片执行器工厂 + §5.1 writeGeneratedAsset。测试：生命周期与去重 409、并发上限排队与调度、cancel（queued 直落/running 等 executor 观测 signal）、重启收尾 INTERRUED→INTERRUPTED、保留 100、参数校验矩阵（§1.3）、进度持久化、图片执行器全流程（假 provider + 真临时工作区，产物经 importAsset 落盘重命名不覆盖）、abort 后状态 cancelled、产物写入失败 → failed ASSET_WRITE_FAILED。**禁改：media-types.ts、design-service.ts、media-image-provider.ts、路由、桌面端。**
- **L32 视频渲染执行器**。新文件 `video-render-service.ts` + `__tests__/video-render-service.test.ts`（deps 全注入假件 + 一个真子进程击杀用例）。实现 §4 全部 + `resolveFfmpegPath`。测试：参数校验（偶数/上限）、RUNTIME_MISSING（chrome/ffmpeg null 两分支）、ENTRY_UNREADABLE、帧写入背压与 progress frames、duration 截止、零帧 RENDER_FAILED、退出码非 0 ENCODE_FAILED、超 256 MiB、取消路径（signal → killTree 被调 + ABORTED、真 spawn 的 `node -e` 子进程被击杀退出）、stdout 组装经 writeGeneratedAsset 落盘。**禁改：media-types.ts、media-task-service.ts、design-service.ts、路由、桌面端。**

### 9.4 Wave 2（Wave 1 验收后，并行 3）

- **L33 媒体路由**。修改 `interfaces/http/design.ts` + `__tests__/design.test.ts` 追加 describe（supertest + 注入假 executors/provider/profiles）。实现 §6 全部端点与真装配、`createDesignRoutes(db, mediaDeps?)`、result 流式下载（真临时文件流回传断言 Content-Type/Disposition）。**禁改：application/design 各服务内部、桌面端。**
- **L34 媒体面板**。新文件 `apps/desktop/src/features/design/media-task-client.ts`、`components/MediaGenPanel.tsx` + `__tests__/media-task-client.test.ts`、`__tests__/MediaGenPanel.test.tsx`（api mock、假计时器）。实现 §8.1/§8.2。**禁改：api.ts、DesignPanel、DesignToolbar、SelectionEditor、AssetLibrary、RenderExportDialog、服务端。**
- **L35 视频素材面**。修改 server `design-service.ts`（VIDEO_EXTENSIONS、listAssets 'video'、ASSET_TYPES 补 mp4/webm/mov MIME）、`resource-graph.ts`（kindForPath video）、`snapshot-service.ts`（SnapshotFileKind 'video' + kind 映射与展示）、`export-service.ts`（kind 跟进）+ 对应测试文件追加；desktop `AssetLibrary.tsx` 视频 tab（列出/体积/无缩略图/不可导入提示）+ `AssetLibrary.test.tsx` 追加。**禁改：media-\* 文件、interfaces/http/design.ts、其余组件。**

### 9.5 Wave 3（Wave 2 验收后，单卡）

- **L36 面板接线与文档**。修改 `DesignPanel.tsx`、`components/DesignToolbar.tsx`（媒体按钮）、`DesignPanel.test.tsx`（api mock 增补媒体端点 + 接线用例：打开/提交/轮询刷新/替换选中图片事务/切页关闭）、`docs/design-workbench.md`（P6 小节）。实现 §8.3。**禁改：L30–L35 已验收文件行为（props 对接可微调并记录）。**

### 9.6 主代理终验收

全部门禁复跑（双端 vitest + tsc、desktop eslint、lifecycle/radius、git status 范围核对）；关键路径代码审查（取消链路、写入边界、凭据不落密、流式端点、迁移幂等）；本机真实视频冒烟（Chrome + ffmpeg 可用时）：临时工作区动画页 → 2s MP4 → ffprobe 校验可播放；更新上游计划 P6 勾选与「当前基线」段、本档验收记录。

## 10. 验收对照（上游计划 P6 验收条目）

| 计划验收项                                                                                                             | 覆盖证据                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 媒体任务接口：输入素材/生成参数/产物/进度/取消/失败/重试；复用任务与进程生命周期；提交去重；产物按工作区归属写入素材库 | §1 任务模型 + L31 测试（去重/调度/取消/重启收尾）；进程生命周期复用 killProcessTree（§4.4）；产物经 importAsset/writeGeneratedAsset 落 design/assets |
| 真实服务生成图片并替换到页面                                                                                           | L30 provider（OpenAI 兼容，覆盖 CogView/OpenAI）+ L34 结果卡替换 + L36 attribute 事务链路；真实付费冒烟为用户手工门槛（§12）                         |
| 基于现有图片修改                                                                                                       | §2.2 edit（multipart /images/edits）+ L34 编辑 tab 源图选择；服务不支持时明确 provider-unsupported 提示                                              |
| 宿主凭据管理，不在设计文件中保存密钥                                                                                   | §0.3 llm_profiles 复用；providers 端点仅 hasCredential（§6）；测试断言响应无 apiKey                                                                  |
| 用户能看到所选服务、任务状态、费用/用量；不能精确报价时明确表示未知                                                    | §3 provider 快照 + usage 归一 +「费用未知」；L34 徽章/阶段/用量行                                                                                    |
| 重试不能无提示重复提交收费任务                                                                                         | §3 确认对话框 + §1.1 并发去重 409（L31/L34 测试）                                                                                                    |
| 取消或重试有明确结果且不丢旧素材                                                                                       | cancel 链路（L31/L32）+ 永不覆盖写入语义（§5.1）；取消后已写产物保留且任务标 cancelled（§1.4）                                                       |
| 短动效可预览并导出可播放 MP4                                                                                           | §4 渲染管线 + L34 `<video>` blob 预览 + 下载；真实冒烟 §9.6/§12                                                                                      |
| 任务取消后相关进程退出                                                                                                 | §4.4 取消路径 killTree + L32 真子进程击杀测试                                                                                                        |
| 大文件分块或流式传输，避免 base64 JSON 承担全部媒体                                                                    | §5.2 result 流式端点（zip 同款直传）+ 客户端 blob 组装                                                                                               |
| 生成失败不替换原素材；成功产物进入历史及导出资源清单                                                                   | §5.1 永不覆盖；§5.3 引用后进快照/导出 + video kind 扩展                                                                                              |
| 每个 provider 独立验收，不以 mock 代表真实服务                                                                         | 本批仅 openai-images；mock 测试覆盖协议与失败路径，真实服务冒烟独立执行并记录（§12）                                                                 |

## 11. 架构约束对照

- 项目文件是作品来源：产物即工作区素材文件，任务表只存记录与引用路径，不建第二作品库 ✓。
- 所有文件访问由宿主处理：渲染/写入全在服务端 containment 内；客户端无新通路（result 端点经 sessionId 授权 + resolve 校验）✓。
- 按能力拆模块：provider / 任务服务 / 视频执行器 / 路由 / 面板各自独立文件，契约集中在 media-types.ts ✓。
- 编辑能力显式声明：视频「近似实时采集」「无音轨」、provider 能力表、费用未知口径均显式 ✓。

## 12. 验收记录

### Wave 1（2026-10-24，主代理验收通过）

L30（openai-images provider）、L31（媒体任务服务）、L32（视频渲染执行器）三卡并行完成：

- **测试**：server design 115 → 205 用例全绿（11 文件；L30 45 + L31 28 + L32 17 = 90，数目吻合）；`tsc --noEmit` 0 错；git status 无越权文件（仅 T0 契约与三个新模块及其测试）。
- **主代理裁决与修正**：① **修正** L30 两处——`downloadImage` 自身 60s 超时误映射 provider-error（改用下载自身 `composed.timedOut` → provider-timeout）；edit multipart 的 image 部件无文件名（undici 会发 `filename="blob"`，按 mime 补 `image.png/.jpg/.webp` 并加断言）。② **接受** L30：provider config 增必填 `model`（设计文档签名遗漏，请求体需要 model 字段，L33 组装时以 ref.model 构造）。③ **接受** L31：`DesignMediaTaskSummary` 落在 media-task-service.ts 导出（冻结的 media-types 未含，L33 直接复用）；`resolveFile` 替代任务卡笔误的 `resolve`（会话作用域入口）；取消优先规则同时覆盖执行器成功路径（cancel(running) 等收尾后必见 cancelled，产物保留）；并发上限按组全局（比按工作区更保守）；`.mov` 进生成白名单（与 L35 扩展集一致）；params 规范化含 targetDir 缺省（dedup 用规范形）。④ **接受** L32：puppeteer-core 25.3.0 无公开 `page.startScreencast(callback)`，改 CDP 原语（`Page.startScreencast` + `screencastFrameAck` 时序正确，与 browser 域同款、注释版本依据）；`deps` 必传 + `defaultVideoRenderDeps()` 展开 + `saveOutput` 注入（绑 L31 `createGeneratedAssetWriter`）；超限判定抽 `assertOutputWithinLimit` 纯函数 + 默认收集中途 SIGKILL；墙钟从 screencast 启动起算；参数复校违规归 RENDER_FAILED、saveOutput 抛错归 ASSET_WRITE_FAILED。
- **代码审查**：L30 信号组合（外部中止优先于超时）、有界下载、私网字面量守卫（172.16–31 精确段）、错误消息不含 apiKey；L31 状态机认领守卫（`WHERE status='queued'`）、终态防双写、cancel 等待收尾、`createGeneratedAssetWriter` 的 realpath(parent) containment + 永不覆盖循环；L32 取消链路（cleanup → killTree → await wait → ABORTED）、帧串行写入背压链、`Promise.race([writeChain, wait()])` 冲刷、真子进程击杀用例（detached `node -e` + 真 killProcessTree）。

### Wave 2（2026-10-24，主代理验收通过）

L33（媒体路由）、L34（媒体面板）、L35（视频素材面）三卡并行完成：

- **测试**：server design 205 → 224 用例全绿（12 文件；L33 9 + L35 10 = 19，数目吻合；另含既有测试微调 2 处见下）；desktop design 651 → 678 用例全绿（39 文件；L34 25 + L35 2 = 27，数目吻合）；双端 `tsc --noEmit` 0 错；desktop eslint 0 error / 34 warning（基线 30 + 4 条 `set-state-in-effect`，与 DeckPanel/RenderExportDialog/BrandPanel 同类既有模式，逐条记录）；lifecycle/radius OK；git status 无越权文件。
- **主代理修正（3 处）**：① 路由 `/assets` kinds 校验文案补 'video'（L35 交接项，两卡文件边界遗留）；② 真装配 `resolveProfileName` 提交期即限定 `providerType==='openai'`（原实现任何型 profile 都能建任务、到执行期才失败 INTERNAL；改为 create 即 400 MEDIA_VALIDATION，执行期守卫保留为纵深防御，测试同步改写）；③ 桌面 types.ts 的 `DesignSnapshotFile.kind` 与 `DesignDependencyKind` 联合补 'video'（L35 冻结边界交接项，服务端联合已扩、桌面镜像）。
- **接受 L33**：三处签名微调按派发裁决落地（`MediaTaskExecution` 可选 `sessionId`、L31 两回调与 L32 `saveOutput` 首参加 sessionId，L31/L32 的 45 用例零改动通过）；POST /media-tasks 201；`MediaTaskService` 惰性构造（首个媒体端点调用触发重启收尾，未迁移场景的既有测试/宿主不受影响，面板轮询自愈）；视频产物名按任务包装执行器现算（saveOutput 冻结签名拿不到 entryPath 的正解）；非 openai profile 拒绝经②上移至提交期。
- **接受 L34**：builders 返回 `sessionId: ''` 占位、面板提交前拼接真实会话（签名最小化）；`mediaPhaseLabel` 增可选 frames 参数；提交成功清内容字段但保留服务/模型选择（视为服务配置）；hook 结果以 `typeof error === 'string'` 判别（成功对象本含 error 键，`'error' in` 恒真——测试已捕获）。
- **接受 L35**：deps-service.ts 一行 kind 联合跟进（kindForPath 传导所需，与 export-service 同类）；既有「非法 kinds」探针的无效示例 'video'→'audio'（video 已合法）；**修正设计文档事实错误**——§5.3 曾断言 `<video src>` 已被资源图收集，实际只有 `<source>` 被收集，L35 补 `<video src>` 分支（文档已订正）；视频体积经 asset 接口 base64 长度换算（≤10 MiB 准确、超限「体积未知」——v1 已知瑕疵，更优的专用 stat 端点留作后续）。
- **代码审查**：providers 端点只回 hasCredential 布尔（测试断言响应不含任何密钥材料）；result 流式下载 headersSent 分支正确；create 201 信封；视频执行器按任务包装无状态泄漏；L34 轮询清理/notifiedRef 去重/blob URL revoke 齐全；L35 的 'all' 联合含视频、IMPORTABLE_EXTENSIONS 未动（视频仍不可导入）。

### Wave 3 + 终验收（2026-10-24，主代理验收通过）

L36（面板接线与文档）单卡完成 + 主代理终验收：

- **测试（终态）**：server design 224 用例全绿（12 文件）+ video-smoke.manual 1 skipped（环境变量门控，默认跳过）；desktop design 682 用例全绿（39 文件；L36 新增 4）；双端 `tsc --noEmit` 0 错（严格退出码复跑）；desktop eslint 0 error / 34 warning（= 基线，L36 新增 0）；lifecycle/radius OK；docs prettier OK；git status 无越权文件。
- **接受 L36**：prop 命名 `onMedia`（既有惯例为 onXxx，卡片字面 onOpenMedia 不合）；替换事务按 `handleApply` 实签名单参调用（label/mergeKey 内部推导，与素材库替换逐字一致）；「媒体」按钮与素材组同款无 disabled（门控在面板层）；onAssetImported 复用 P4 `handleAssetImported` 未新抽。
- **主代理修正（3 处）**：① Wave 2 修正③（types.ts 补 'video'）漏改两个消费方——VersionDiff/VersionHistory 的 KIND_LABEL 各补 `video: '视频'`（L36 上报，主代理落）；② 验收手法自查——此前 `tsc | tail` 管道掩盖退出码可能误判，终验收全部改为严格退出码复跑；③ **真实冒烟暴露并修正视频时长缺陷**（见下）。
- **真实视频冒烟（本机 Chrome + homebrew ffmpeg，通过）**：新增环境变量门控的手工测试 `__tests__/video-smoke.manual.test.ts`（`ZCLAUDIA_MEDIA_SMOKE=1` 运行；2s CSS 动画页 → 真 Chrome screencast → ffmpeg → 工作区 MP4，ffprobe 校验容器与时长）。首轮冒烟暴露真实缺陷：**image2pipe 按 `-framerate` 给每帧固定时长，Chromium ~58fps 采集对 24fps 目标造成 2.5 倍慢放（请求 2s 实得 ~4.96s）**，设计文档声称的「不足补帧、过密丢帧」语义实际未达成。修正（主代理落，L32 测试同步改写两条）：帧回调按目标帧率开时隙（密帧丢弃到槽率）、停止后以尾帧补齐至 `targetFrames = durationMs×fps/1000`（静态页/低帧率页也能得到请求时长）、写满即提前停采；`VideoRenderDeps` 增可注入 `now()` 时钟。修正后写入总数恒等于目标帧数 → 时长恒等于请求值；冒烟复跑通过（时长断言 1.0–3.5s 内通过，全程 ~3.5s）。
- **待补验证状态**：真实付费图片服务冒烟（用户配 key）与 macOS Tauri 内嵌服务端视频流程仍为手工门槛（§12 清单）；视频管线已在本机真实环境闭环验证。

### 待补验证（手工门槛）

1. **真实付费图片服务冒烟（用户）**：配置 bigmodel（CogView）或 OpenAI profile，生成一张图并替换到页面；image-edit 视服务支持情况分别验证（CogView 预期 provider-unsupported 提示）。

- **本机真实视频冒烟（主代理/用户）**：Chrome + ffmpeg 就绪的机器上渲染 2s 动画页 MP4 并播放验证；macOS Tauri 内嵌服务端同流程。
- **费用核对（用户）**：对照服务控制台用量与任务 usage 展示。
