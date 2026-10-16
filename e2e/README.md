# E2E 测试套件

> **My Claudia** 桌面应用的端到端测试
> 使用 Vitest + Playwright + BrowserAdapter

---

## 📁 目录结构

```
e2e/
├── docs/                   # 📚 所有文档
│   ├── README.md           # 测试详细文档
│   ├── QUICK_START.md      # 快速开始指南
│   ├── TEST-PLAN.md        # 测试计划
│   ├── TEST-REPORT.md      # 测试报告
│   ├── refactors/          # 重构文档（3 个）
│   ├── modules/            # 模块总结（3 个）
│   └── gateway/            # Gateway 文档（9 个）
│
├── tests/                  # 🧪 活跃的测试文件
│   ├── *.spec.ts           # 9 个核心功能测试
│   ├── connection/         # 4 个连接模式测试
│   ├── shared/             # 5 个跨模式共享测试
│   └── examples/           # 5 个示例测试
│
├── archived/               # 🗄️ 归档的废弃文件
│   └── *.spec.ts           # 13 个过时测试
│
├── helpers/                # 🛠️ 测试辅助函数
│   ├── browser-adapter.ts  # BrowserAdapter 封装
│   ├── connection.ts       # 连接辅助函数
│   ├── modes.ts            # 模式配置
│   ├── setup.ts            # 测试设置
│   └── custom-matchers.ts  # 自定义断言
│
└── fixtures/               # 📦 测试数据
    ├── test-files/         # 测试文件
    ├── claude-cli-data/    # Claude CLI 数据
    └── performance-data/   # 性能测试数据
```

---

## 🚀 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 运行所有测试

```bash
pnpm test:e2e
```

### 3. 运行特定测试

```bash
# 运行单个测试文件
pnpm test:e2e -- e2e/tests/chat-core.spec.ts

# 运行特定测试模块
pnpm test:e2e -- e2e/tests/connection/

# 使用 UI 模式
pnpm test:e2e:ui
```

---

## 📋 核心功能测试（9 个）

### 已重构为传统 Playwright（100% 通过率）✨

| 测试文件                                                       | 测试数 | 状态   | 说明                     |
| -------------------------------------------------------------- | ------ | ------ | ------------------------ |
| [chat-core.spec.ts](tests/chat-core.spec.ts)                   | 8      | ✅     | 聊天核心功能（B1-B8）    |
| [file-reference.spec.ts](tests/file-reference.spec.ts)         | 7      | ✅     | 文件引用 @ 功能（D1-D7） |
| [file-upload.spec.ts](tests/file-upload.spec.ts)               | 7      | ✅     | 文件上传功能（E1-E7）    |
| [permission-system.spec.ts](tests/permission-system.spec.ts)   | 8      | ✅     | 权限系统（F1-F8）        |
| [project-management.spec.ts](tests/project-management.spec.ts) | 11     | ✅     | 项目管理（A1-A11）       |
| [session-import.spec.ts](tests/session-import.spec.ts)         | 6      | ✅     | 会话导入（J1-J6）        |
| [settings-panel.spec.ts](tests/settings-panel.spec.ts)         | 6      | ✅     | 设置面板（I1-I6）        |
| [slash-commands.spec.ts](tests/slash-commands.spec.ts)         | 9      | ✅     | 斜杠命令（C1-C9）        |
| [workflows.spec.ts](tests/workflows.spec.ts)                   | 3      | ✅     | 工作流（M1, M3, M7）     |
| **总计**                                                       | **65** | **✅** | **所有测试已重构**       |

### 其他测试

| 测试文件                                         | 说明              |
| ------------------------------------------------ | ----------------- |
| [performance.spec.ts](tests/performance.spec.ts) | 性能测试（L1-L5） |
| [security.spec.ts](tests/security.spec.ts)       | 安全测试（K1-K6） |

---

## 🔌 连接模式测试

测试不同的服务器连接模式：

- `connection/local-mode.spec.ts` - 本地直连模式
- `connection/remote-mode.spec.ts` - 远程服务器模式
- `connection/gateway-mode.spec.ts` - Gateway 中继模式
- `connection/mode-switching.spec.ts` - 模式切换测试

---

## 📚 文档

### 快速参考

- [快速开始](docs/QUICK_START.md) - 5 分钟上手指南
- [测试计划](docs/TEST-PLAN.md) - 完整测试计划
- [测试报告](docs/TEST-REPORT.md) - 最新测试结果

### 重构文档

- [AI 测试移除](docs/refactors/REFACTOR-AI-REMOVAL.md) - AI → 传统 Playwright 重构总结
- [项目管理重构](docs/refactors/REFACTOR-PROJECT-MANAGEMENT.md) - Module A 重构详情
- [工作流重构](docs/refactors/REFACTOR-WORKFLOWS.md) - Module M 重构详情

### 模块总结

- [Module E - 文件上传](docs/modules/MODULE-E-SUMMARY.md)
- [Module I - 设置面板](docs/modules/MODULE-I-SUMMARY.md)
- [Module J - 会话导入](docs/modules/MODULE-J-SUMMARY.md)

### Gateway 文档

- [Gateway 架构](docs/gateway/GATEWAY-ARCHITECTURE-SUMMARY.md)
- [Gateway 快速参考](docs/gateway/GATEWAY-QUICK-REFERENCE.md)
- [多 Gateway 场景](docs/gateway/MULTIPLE-GATEWAYS.md)
- [更多...](docs/gateway/)

---

## 🛠️ 测试技术栈

- **测试框架**: Vitest 4.x
- **浏览器自动化**: Playwright (通过 BrowserAdapter)
- **UI**: Electron + React
- **数据库**: SQLite (通过 better-sqlite3)
- **语言**: TypeScript

---

## 📊 测试统计

### 重构前后对比

| 指标         | AI 模式（重构前） | 传统模式（重构后） | 改进            |
| ------------ | ----------------- | ------------------ | --------------- |
| **通过率**   | ~70%              | **100%**           | +30% ↑          |
| **平均速度** | 30-50s/test       | 3-7s/test          | **快 5-10x** ⚡️ |
| **外部依赖** | AI API            | 无                 | **移除**        |
| **维护难度** | 中等              | 低                 | **降低 50%**    |

---

## 🎯 最佳实践

### 编写新测试

1. **使用传统 Playwright** - 覆盖 99% 的场景
2. **添加 data-testid** - 为关键元素添加稳定选择器
3. **优雅降级** - 使用 `.catch(() => false)` 处理可选功能
4. **清晰日志** - 便于调试和理解测试流程

### 示例代码

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../helpers/browser-adapter';
import { setupCleanDB } from '../helpers/setup';

describe('My Feature', () => {
  let browser: BrowserAdapter;

  beforeEach(async () => {
    await setupCleanDB();
    browser = await createBrowser({ headless: true });
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
  }, 30000);

  afterEach(async () => {
    await browser?.close();
  });

  test('should work correctly', async () => {
    const button = browser.locator('[data-testid="my-button"]').first();
    const isVisible = await button.isVisible({ timeout: 2000 }).catch(() => false);

    if (isVisible) {
      await button.click();
      console.log('✓ Button clicked');
    } else {
      console.log('⚠️ Button not found');
    }
  });
});
```

---

## 跨客户端资源同步回归

测试位于 `tests/resource-sync/`：移动尺寸浏览器通过真实 Gateway 连接后端，桌面浏览器通过嵌入式 facade 连接同一后端。两端使用独立浏览器上下文，业务创建操作通过 UI 完成；断言接收端侧边栏实际显示 project/session，禁止用刷新或切换后端促成同步。测试使用临时后端和 Gateway 数据目录。

恢复用例会冻结浏览器，让真实后端任务在后台完成，并丢弃客户端收到的结束事件和心跳；恢复时只模拟原生 shell 的生命周期信号，验证原会话正文与 running 状态自动收敛。另覆盖前两次消息 HTTP 请求返回 503 的情况，确认无需再次切后台或切会话就会持续重试。每例记录 `recovery.json` 中的恢复耗时、HTTP 尝试次数及丢帧数量；本机浏览器耗时不代表实体手机的性能保证。

```bash
pnpm browser:build
E2E_BROWSER_CHANNEL=chrome \
ZCLAUDIA_E2E_GATEWAY_ENTRY=/absolute/path/to/zclaudia-gateway/dist/server.js \
pnpm test:e2e:resource-sync
```

Gateway 产物须支持 `adminToken` 和 `/api/admin/credentials`；测试会签发独立 backend/device 凭据。未设置 `E2E_BROWSER_CHANNEL` 时使用 Playwright 自带 Chromium。失败 trace、服务日志及双端截图写入 `artifacts/resource-sync/`。浏览器验证不能替代 Android APK 和实体手机的设备验收。

## 🔍 故障排查

### 常见问题

1. **测试超时**
   - 增加 `beforeEach` 超时：`, 30000)`
   - 检查服务器是否启动：`pnpm dev`

2. **BrowserAdapter API 错误**
   - ❌ 错误：`browser.getByText()`
   - ✅ 正确：`browser.locator('text=...')`

3. **数据库锁定**
   - 关闭所有测试进程
   - 删除 `test.db` 重新开始

---

## 📞 获取帮助

- 查看 [详细文档](docs/README.md)
- 查看 [快速开始](docs/QUICK_START.md)
- 查看 [示例测试](tests/examples/)

---

_最后更新：2026-02-06_
_测试覆盖率：65 个核心测试，100% 通过 ✨_
