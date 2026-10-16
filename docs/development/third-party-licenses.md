# 三方许可（third-party licenses）：盘点、声明与门禁

本仓库的三方合规流水线移植自 ZCode `scripts/licenses.mjs`（Apache-2.0，
Copyright 2026 Z.AI Co., Ltd.），适配 zclaudia 的 pnpm workspace（隔离布局，
传递依赖位于 `node_modules/.pnpm` 虚拟 store）。

## 组成

| 文件                                                | 作用                                                 | 是否入库            |
| --------------------------------------------------- | ---------------------------------------------------- | ------------------- |
| `scripts/licenses.mjs`                              | 入口：`notices` 生成声明、`check` 跑门禁             | 是                  |
| `scripts/licenses/third-party-npm.mjs`              | 读取 pnpm 生产图 + 递归扫描实装包 + 收集包内许可文件 | 是                  |
| `scripts/licenses/generate-third-party-notices.mjs` | 生成 `THIRD-PARTY-NOTICES.md`                        | 是                  |
| `scripts/licenses/third-party-notices.mjs`          | 声明读取/新鲜度校验 + inventory 结构校验             | 是                  |
| `third-party/inventory.json`                        | 人工维护的登记文件（复核结论、搬入源码）             | 是                  |
| `third-party/npm-overrides.json`                    | 可选：无完整许可文件的生产包补充材料登记             | 按需                |
| `THIRD-PARTY-NOTICES.md`                            | 生成产物（生产依赖精确版本的原始许可文本）           | **否**（gitignore） |

## 常用命令

```bash
pnpm licenses:check     # 门禁：allowlist 之外或许可未知即失败（等价 node scripts/licenses.mjs check）
pnpm licenses:notices   # 生成/刷新 THIRD-PARTY-NOTICES.md
node scripts/licenses.mjs check --strict   # 发布前：声明缺失/过期从告警转为失败（登记结论本身即为复核产物，不随 strict 翻转）
```

`check` 的判定范围是**全量实装包（prod+dev）**：实装清单从全部 workspace
`node_modules`（含 `.pnpm` store、嵌套版本与符号链接）递归收集；生产依赖
（prod）按 `pnpm-lock.yaml` 的生产图判定，且锁文件图与实装图先做一致性断言。
其他平台的三方可选包（锁文件按 `os`/`cpu` 排除、本机不安装的）不算缺失。

`notices` 只作用于**生产依赖**：按精确版本收集每个包内的 LICENSE/COPYING/NOTICE
等真实许可文本（同文本去重共享），并在文件尾部附机器可读清单（`<!--
zclaudia-licenses-manifest -->`），`check` 用它判断声明是否覆盖当前生产图。
依赖变更后请重新运行 `notices`。

## 分类口径

| 桶                                                                     | 含义                                                                       | check 行为                                           |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| `green`                                                                | MIT/ISC/BSD/Apache-2.0/Zlib/CC0/CC-BY/OFL-1.x 等宽松许可（含 OR/AND 组合） | 放行                                                 |
| `yellow-lgpl` / `yellow-weak`(MPL/EPL/CDDL) / `yellow-cc`(CC-BY-ND/SA) | 弱版权/需登记复核                                                          | 在 `inventory.json` 登记 `reviewRequired` 结论后放行 |
| `review-proprietary`                                                   | 人工核实的专有运行时（如 `@anthropic-ai/claude-agent-sdk`）                | 同 yellow：登记后放行                                |
| `missing` / `unresolved` / `review`                                    | 许可字段缺失、只写指针、无法识别                                           | 一律退出码 1                                         |
| `red-gpl` / `red-agpl` / `red-semiopen`(SSPL/BSL…) / `red-nc`(CC-NC)   | 强版权/半开放/禁商用                                                       | 一律退出码 1                                         |

分类表与 ZCode `scripts/licenses.mjs` 一致，另有两处扩展：OFL-1.0/1.1
（SIL 开源字体许可，允许随软件捆绑与再分发）计入 green；专有运行时标识经
脚本内 `MANUAL_LICENSE` 人工核实后归入 `review-proprietary`（必须在
`inventory.json` 登记结论）。登记项的 `id` 支持以 `*` 结尾的前缀模式，`bucket`
必须与包的实时分类一致——上游改了许可标识，登记自动失效并重新阻断。

## third-party/inventory.json 登记结构

```jsonc
{
  "schemaVersion": 1,
  // 黄灯/专有运行时的复核结论登记；check 逐条与实装包比对
  "reviewRequired": [
    {
      "id": "包名或前缀模式（如 @img/sharp-libvips-*）",
      "bucket": "yellow-lgpl | yellow-weak | yellow-cc | review-proprietary",
      "reason": "人工复核结论（为什么可以接受、使用边界是什么）",
      "date": "YYYY-MM-DD",
      "decidedBy": "可选",
    },
  ],
  // 从 ZCode 等上游搬入本仓库的源码/资产登记（每次搬入新增一条）
  "copiedComponents": [],
}
```

### 搬入 ZCode 源码时的登记要求（copiedComponents）

后续任何从 ZCode（Apache-2.0）搬入源码的改动，除文件头保留归属注释
（`Copyright 2026 Z.AI Co., Ltd. — adapted from <原路径> (Apache-2.0)`）外，
还需在 `copiedComponents` 追加一条：

```jsonc
{
  "id": "组件标识（如 zcode-runner）",
  "roots": ["scripts/distribution/"], // 搬入代码所在目录（必须真实存在）
  "license": "Apache-2.0",
  "source": "ZCode scripts/zcode-distribution/runner.mjs",
  "copyright": "Copyright 2026 Z.AI Co., Ltd.",
  "importedAt": "YYYY-MM-DD",
  "notes": "可选：修改说明；文件内修改需保留 Modified by … 声明",
}
```

`notices` 会把这些组件列入 `THIRD-PARTY-NOTICES.md` 的 "Copied source and
assets" 分节；`check` 校验必填字段与 roots 存在性。

## 生产包缺许可文件时（npm-overrides.json）

生产依赖中若有包只提供 README 里的许可段落、没有完整许可文件，`notices` 会
失败并列出包名。处置方式是新增 `third-party/npm-overrides.json`：保存上游
原文（如 `third-party/upstream/<pkg>-<version>-LICENSE`），登记

```jsonc
[
  {
    "package": "name@version",
    "file": "third-party/upstream/…", // sha256 必须与文件一致，改动即失败
    "sha256": "…",
    "source": "https://… 上游原始许可文件的 URL/出处",
  },
]
```

## 与 ZCode 原版的差异

- pnpm 隔离布局：实装扫描额外枚举 `node_modules/.pnpm` 虚拟 store（ZCode 为
  hoisted 布局）；`readInstallTargets` 不依赖 `yaml` 包，按需解析
  `pnpm-workspace.yaml` 的 `supportedArchitectures`。
- `inventory.json` 是人工维护的登记文件而非生成产物；声明新鲜度不靠输入哈希
  机器，而是比对生成文件尾部的包清单（基础 check 告警、`--strict` 失败）。
- 复核结论从脚本内联数组移到 `inventory.json`，便于审查与历史追溯。
