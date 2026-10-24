/**
 * ZClaudia 内置设计模板目录（P4.1）。
 *
 * 模板是自研纯静态脚手架（来源固定 'zclaudia-builtin'）：每个模板 =
 * 一份 index.html + 一份 styles.css，安装时整体复制进工作区 `design/<id>/`，
 * 互不覆盖、不动 design/index.html。内容自包含：无脚本、无内联事件、
 * 无外链（图片只用内联 SVG 与 CSS 渐变，src/href 只允许相对路径与 # 锚点），
 * 每个文件 ≤12 KiB。硬性约束由 template-service.test.ts 的目录不变量逐条锁死。
 */

export interface DesignTemplateSummary {
  id: string;
  /** 中文名。 */
  name: string;
  /** 中文一句话描述。 */
  description: string;
  /** 安装后的工作区相对入口路径（design/<id>/index.html）。 */
  entry: string;
  /** 模板将写入的全部文件（不含安装时生成的 TEMPLATE.json）。 */
  files: string[];
  version: string;
  source: string;
}

export interface TemplateFileSource {
  /** 工作区相对路径（/ 分隔）。 */
  path: string;
  content: string;
}

export interface TemplateDefinition extends DesignTemplateSummary {
  /** 模板源文件，与 files 一一对应。 */
  sources: readonly TemplateFileSource[];
}

const TEMPLATE_VERSION = '1.0.0';
const TEMPLATE_SOURCE = 'zclaudia-builtin';
const MAX_TEMPLATE_FILE_BYTES = 12 * 1024;

function defineTemplate(
  id: string,
  name: string,
  description: string,
  html: string,
  css: string
): TemplateDefinition {
  const sources: readonly TemplateFileSource[] = [
    { path: `design/${id}/index.html`, content: html },
    { path: `design/${id}/styles.css`, content: css },
  ];
  for (const source of sources) {
    if (Buffer.byteLength(source.content, 'utf8') > MAX_TEMPLATE_FILE_BYTES) {
      throw new Error(`Template ${id} file ${source.path} exceeds the 12 KiB catalog limit`);
    }
  }
  return {
    id,
    name,
    description,
    entry: `design/${id}/index.html`,
    files: sources.map(source => source.path),
    version: TEMPLATE_VERSION,
    source: TEMPLATE_SOURCE,
    sources,
  };
}

const landing = defineTemplate(
  'landing',
  'Landing page',
  'A single-page marketing landing page with a hero section, feature grid, testimonials, and a call to action.',
  `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>云帆笔记 · 记录每一次灵感</title>
  <meta name="description" content="云帆笔记落地页模板：首屏介绍、特性网格与行动号召。">
  <link rel="stylesheet" href="styles.css">
</head>
<body id="top">
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="#top">
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 19 12 4l8 15H4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
        <span>云帆笔记</span>
      </a>
      <nav class="site-nav" aria-label="主导航">
        <a href="#features">功能特性</a>
        <a href="#voices">用户声音</a>
        <a href="#cta">立即开始</a>
      </nav>
    </div>
  </header>

  <main>
    <section class="hero" id="hero">
      <div class="container">
        <p class="eyebrow">全新 2.0 版本正式发布</p>
        <h1>记录灵感，<br>让好想法不再溜走</h1>
        <p class="lead">云帆笔记把碎片记录、任务清单与团队协作放进同一个工作区，随手写下的每一行都能长成完整的计划。</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#cta">免费开始使用</a>
          <a class="btn btn-ghost" href="#features">了解功能特性</a>
        </div>
      </div>
    </section>

    <section class="features" id="features">
      <div class="container">
        <h2>为专注而生的功能</h2>
        <p class="section-lead">三个核心能力，覆盖从灵感到落地的全过程。</p>
        <div class="feature-grid">
          <article class="feature-card">
            <div class="feature-icon">
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 4h14v16l-7-3-7 3V4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
            </div>
            <h3>随手收藏</h3>
            <p>网页、语音、截图一键存入收件箱，自动按主题归档，找回只需一次搜索。</p>
          </article>
          <article class="feature-card">
            <div class="feature-icon">
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </div>
            <h3>任务看板</h3>
            <p>把笔记一键转成待办，拖拽即可排期，进度在看板上一目了然。</p>
          </article>
          <article class="feature-card">
            <div class="feature-icon">
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 19c0-3 2.4-5 5-5s5 2 5 5M16 13c2.2 0 4 1.6 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </div>
            <h3>团队协作</h3>
            <p>邀请同事共同编辑，评论与修订历史完整保留，分歧随时回溯。</p>
          </article>
        </div>
      </div>
    </section>

    <section class="voices" id="voices">
      <div class="container">
        <h2>他们都在用云帆笔记</h2>
        <div class="voice-grid">
          <blockquote class="voice-card">
            <p>“从碎片记录到周会纪要，一个工具就够了。”</p>
            <footer>林晚 · 独立开发者</footer>
          </blockquote>
          <blockquote class="voice-card">
            <p>“看板视图让我们的版本排期快了一倍。”</p>
            <footer>周航 · 产品经理</footer>
          </blockquote>
        </div>
      </div>
    </section>

    <section class="cta" id="cta">
      <div class="container cta-inner">
        <h2>现在，写下第一条笔记</h2>
        <p>注册即享 14 天全功能试用，无需绑定支付方式。</p>
        <a class="btn btn-light" href="#top">创建我的工作区</a>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <p>© 2026 云帆笔记 · 让记录更轻盈</p>
      <nav aria-label="页脚导航">
        <a href="#features">功能</a>
        <a href="#voices">口碑</a>
        <a href="#cta">开始</a>
      </nav>
    </div>
  </footer>
</body>
</html>
`,
  `/* 云帆笔记 · 落地页模板样式（自包含，可自由修改） */
:root {
  --color-primary: #4f46e5;
  --color-primary-dark: #4338ca;
  --color-accent: #f59e0b;
  --color-background: #f8fafc;
  --color-surface: #ffffff;
  --color-text: #1e293b;
  --color-text-muted: #64748b;
  --color-border: #e2e8f0;
  --font-body: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  --radius-lg: 16px;
  --radius-md: 10px;
  --shadow-card: 0 10px 30px rgba(15, 23, 42, 0.08);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--font-body);
  color: var(--color-text);
  background: var(--color-background);
  line-height: 1.7;
}

h1, h2, h3 { line-height: 1.25; margin: 0 0 0.5em; }
p { margin: 0 0 1em; }
a { color: var(--color-primary); text-decoration: none; }
svg { vertical-align: middle; }

.container { width: min(1080px, 92vw); margin: 0 auto; }

/* 顶栏 */
.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(255, 255, 255, 0.92);
  border-bottom: 1px solid var(--color-border);
}
.header-inner { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; }
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 18px; color: var(--color-text); }
.site-nav { display: flex; gap: 24px; }
.site-nav a { color: var(--color-text-muted); font-size: 15px; }
.site-nav a:hover { color: var(--color-primary); }

/* 按钮 */
.btn { display: inline-block; padding: 12px 28px; border-radius: 999px; font-weight: 600; transition: transform 0.15s ease; }
.btn:hover { transform: translateY(-1px); }
.btn-primary { background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark)); color: #fff; }
.btn-ghost { color: var(--color-primary); border: 1px solid var(--color-primary); }
.btn-light { background: #fff; color: var(--color-primary); }

/* Hero 首屏 */
.hero {
  padding: 96px 0 80px;
  text-align: center;
  background:
    radial-gradient(circle at 20% 10%, rgba(79, 70, 229, 0.12), transparent 45%),
    radial-gradient(circle at 85% 20%, rgba(245, 158, 11, 0.12), transparent 40%);
}
.eyebrow { display: inline-block; padding: 4px 14px; border-radius: 999px; background: rgba(79, 70, 229, 0.1); color: var(--color-primary); font-size: 14px; font-weight: 600; }
.hero h1 { font-size: clamp(32px, 5vw, 52px); margin: 18px 0; }
.lead { max-width: 560px; margin: 0 auto 28px; color: var(--color-text-muted); font-size: 18px; }
.hero-actions { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }

/* 特性网格 */
.features { padding: 72px 0; }
.features h2, .voices h2 { text-align: center; font-size: 30px; }
.section-lead { text-align: center; color: var(--color-text-muted); margin-bottom: 40px; }
.feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
.feature-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 28px; box-shadow: var(--shadow-card); }
.feature-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, rgba(79, 70, 229, 0.15), rgba(245, 158, 11, 0.15));
  color: var(--color-primary);
  margin-bottom: 16px;
}
.feature-card h3 { font-size: 18px; }
.feature-card p { color: var(--color-text-muted); margin: 0; }

/* 用户声音 */
.voices { padding: 24px 0 72px; }
.voice-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; }
.voice-card { margin: 0; background: var(--color-surface); border-left: 4px solid var(--color-accent); border-radius: var(--radius-md); padding: 24px; }
.voice-card p { font-size: 17px; }
.voice-card footer { color: var(--color-text-muted); font-size: 14px; }

/* 行动号召 */
.cta { padding: 80px 0; background: linear-gradient(135deg, var(--color-primary), #7c3aed); color: #fff; text-align: center; }
.cta h2 { font-size: 32px; }
.cta p { opacity: 0.9; margin-bottom: 28px; }

/* 页脚 */
.site-footer { border-top: 1px solid var(--color-border); padding: 28px 0; color: var(--color-text-muted); font-size: 14px; }
.footer-inner { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }

/* 窄屏适配 */
@media (max-width: 720px) {
  .hero { padding: 64px 0 48px; }
  .feature-grid, .voice-grid { grid-template-columns: 1fr; }
  .site-nav { gap: 14px; }
  .site-nav a { font-size: 14px; }
  .header-inner { flex-direction: column; gap: 8px; }
}
`
);

const dashboard = defineTemplate(
  'dashboard',
  'Dashboard',
  'An admin dashboard with sidebar navigation, a metric card grid, and pure-CSS bar charts.',
  `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>星图运营台 · 数据看板</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <aside class="sidebar">
    <p class="logo">星图运营台</p>
    <nav aria-label="侧栏导航">
      <a class="active" href="#overview">数据总览</a>
      <a href="#trend">访问趋势</a>
      <a href="#orders">最新订单</a>
    </nav>
    <p class="sidebar-note">v1.0 内测版</p>
  </aside>

  <div class="layout">
    <header class="topbar">
      <div>
        <h1>早上好，运营团队</h1>
        <p class="topbar-sub">今天是 10 月 23 日 · 数据每 5 分钟自动刷新</p>
      </div>
      <div class="topbar-actions">
        <span class="badge">实时同步中</span>
        <span class="avatar" aria-hidden="true">运</span>
      </div>
    </header>

    <main id="overview">
      <section class="stat-grid" aria-label="核心指标">
        <article class="stat-card">
          <p class="stat-label">今日访问</p>
          <p class="stat-value">12,480</p>
          <p class="stat-delta up">较昨日上升 8.2%</p>
        </article>
        <article class="stat-card">
          <p class="stat-label">新增用户</p>
          <p class="stat-value">326</p>
          <p class="stat-delta up">较昨日上升 4.6%</p>
        </article>
        <article class="stat-card">
          <p class="stat-label">支付转化</p>
          <p class="stat-value">3.9%</p>
          <p class="stat-delta down">较昨日下降 0.4%</p>
        </article>
        <article class="stat-card">
          <p class="stat-label">待处理工单</p>
          <p class="stat-value">17</p>
          <p class="stat-delta">需要在今日内跟进</p>
        </article>
      </section>

      <section class="panel-grid">
        <article class="panel" id="trend">
          <h2>近 7 日访问趋势</h2>
          <div class="bars" role="img" aria-label="近 7 日访问趋势柱状图">
            <span class="bar bar-1"></span>
            <span class="bar bar-2"></span>
            <span class="bar bar-3"></span>
            <span class="bar bar-4"></span>
            <span class="bar bar-5"></span>
            <span class="bar bar-6"></span>
            <span class="bar bar-7"></span>
          </div>
          <p class="panel-foot">周一至周日 · 单位：千次</p>
        </article>

        <article class="panel" id="orders">
          <h2>最新订单</h2>
          <ul class="orders">
            <li><span class="order-name">专业版年卡 · 陈晓</span><span class="order-amount">¥ 1,299</span></li>
            <li><span class="order-name">团队版季卡 · 蓝湾工作室</span><span class="order-amount">¥ 2,400</span></li>
            <li><span class="order-name">专业版月卡 · 何雨</span><span class="order-amount">¥ 129</span></li>
            <li><span class="order-name">团队版年卡 · 远山设计</span><span class="order-amount">¥ 8,800</span></li>
          </ul>
          <p class="panel-foot">共 4 笔待确认</p>
        </article>
      </section>
    </main>

    <footer class="dash-footer">
      <p>© 2026 星图运营台 · 示例数据仅用于演示</p>
    </footer>
  </div>
</body>
</html>
`,
  `/* 星图运营台 · 仪表盘模板样式（自包含，可自由修改） */
:root {
  --color-primary: #0f766e;
  --color-primary-light: #14b8a6;
  --color-sidebar: #0f172a;
  --color-sidebar-text: #cbd5f5;
  --color-background: #f1f5f9;
  --color-surface: #ffffff;
  --color-text: #0f172a;
  --color-text-muted: #64748b;
  --color-up: #16a34a;
  --color-down: #dc2626;
  --color-border: #e2e8f0;
  --font-body: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  --radius-md: 12px;
  --shadow-card: 0 6px 18px rgba(15, 23, 42, 0.06);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  display: flex;
  min-height: 100vh;
  font-family: var(--font-body);
  background: var(--color-background);
  color: var(--color-text);
  line-height: 1.6;
}

h1, h2 { margin: 0 0 0.4em; }
p { margin: 0; }
a { text-decoration: none; }

/* 侧栏 */
.sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--color-sidebar);
  color: var(--color-sidebar-text);
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.logo { font-size: 18px; font-weight: 700; color: #fff; }
.sidebar nav { display: flex; flex-direction: column; gap: 6px; }
.sidebar nav a { padding: 10px 14px; border-radius: 8px; color: var(--color-sidebar-text); font-size: 15px; }
.sidebar nav a:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
.sidebar nav a.active { background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light)); color: #fff; font-weight: 600; }
.sidebar-note { margin-top: auto; font-size: 12px; opacity: 0.6; }

/* 主区布局 */
.layout { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 32px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}
.topbar h1 { font-size: 22px; }
.topbar-sub { color: var(--color-text-muted); font-size: 14px; }
.topbar-actions { display: flex; align-items: center; gap: 12px; }
.badge { padding: 4px 12px; border-radius: 999px; background: rgba(20, 184, 166, 0.12); color: var(--color-primary); font-size: 13px; font-weight: 600; }
.avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light));
  color: #fff;
  font-weight: 600;
}

main { padding: 32px; display: flex; flex-direction: column; gap: 24px; }

/* 指标卡片网格 */
.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
.stat-card { background: var(--color-surface); border-radius: var(--radius-md); box-shadow: var(--shadow-card); padding: 20px; }
.stat-label { color: var(--color-text-muted); font-size: 14px; }
.stat-value { font-size: 28px; font-weight: 700; margin-top: 6px; }
.stat-delta { margin-top: 6px; font-size: 13px; color: var(--color-text-muted); }
.stat-delta.up { color: var(--color-up); }
.stat-delta.down { color: var(--color-down); }

/* 面板网格 */
.panel-grid { display: grid; grid-template-columns: 3fr 2fr; gap: 20px; }
.panel { background: var(--color-surface); border-radius: var(--radius-md); box-shadow: var(--shadow-card); padding: 20px 24px; }
.panel h2 { font-size: 16px; }
.panel-foot { margin-top: 12px; color: var(--color-text-muted); font-size: 13px; }

/* 纯 CSS 柱状图 */
.bars { display: flex; align-items: flex-end; gap: 14px; height: 180px; padding: 12px 4px 0; }
.bar { flex: 1; border-radius: 6px 6px 0 0; background: linear-gradient(180deg, var(--color-primary-light), var(--color-primary)); }
.bar-1 { height: 45%; }
.bar-2 { height: 62%; }
.bar-3 { height: 38%; }
.bar-4 { height: 74%; }
.bar-5 { height: 58%; }
.bar-6 { height: 86%; }
.bar-7 { height: 70%; }

/* 订单列表 */
.orders { list-style: none; margin: 0; padding: 0; }
.orders li { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px dashed var(--color-border); font-size: 14px; }
.orders li:last-child { border-bottom: 0; }
.order-amount { font-weight: 600; color: var(--color-primary); }

.dash-footer { margin-top: auto; padding: 16px 32px; color: var(--color-text-muted); font-size: 13px; border-top: 1px solid var(--color-border); }

/* 窄屏适配 */
@media (max-width: 960px) {
  body { flex-direction: column; }
  .sidebar { width: 100%; flex-direction: row; align-items: center; }
  .sidebar nav { flex-direction: row; flex-wrap: wrap; }
  .sidebar-note { margin: 0 0 0 auto; }
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
  .panel-grid { grid-template-columns: 1fr; }
}
`
);

const mobile = defineTemplate(
  'mobile',
  'Mobile prototype',
  'A 390px single-column mobile to-do list prototype with a progress card, task list, and bottom tab bar.',
  `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>晨光清单 · 移动端原型</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="app" id="top">
    <header class="app-header">
      <div>
        <h1>晨光清单</h1>
        <p class="app-date">10 月 23 日 · 星期五</p>
      </div>
      <span class="app-avatar" aria-hidden="true">晨</span>
    </header>

    <main>
      <section class="progress-card" aria-label="今日进度">
        <p class="progress-label">今日进度</p>
        <p class="progress-value">3 / 5 已完成</p>
        <div class="progress-track"><div class="progress-fill"></div></div>
      </section>

      <section class="task-section" aria-label="待办列表">
        <h2>待办事项</h2>
        <ul class="task-list">
          <li class="task done">
            <span class="check">✓</span>
            <div>
              <p class="task-title">晨间拉伸 15 分钟</p>
              <p class="task-time">07:30 · 已完成</p>
            </div>
          </li>
          <li class="task done">
            <span class="check">✓</span>
            <div>
              <p class="task-title">阅读《设计心理学》第 4 章</p>
              <p class="task-time">09:00 · 已完成</p>
            </div>
          </li>
          <li class="task">
            <span class="check"></span>
            <div>
              <p class="task-title">整理周会纪要并发给团队</p>
              <p class="task-time">14:00 · 进行中</p>
            </div>
          </li>
          <li class="task">
            <span class="check"></span>
            <div>
              <p class="task-title">预约周末的羽毛球场地</p>
              <p class="task-time">18:00 · 待开始</p>
            </div>
          </li>
          <li class="task">
            <span class="check"></span>
            <div>
              <p class="task-title">给爸妈打电话</p>
              <p class="task-time">20:30 · 待开始</p>
            </div>
          </li>
        </ul>
      </section>

      <section class="tip-card">
        <h2>小贴士</h2>
        <p>把最重要的事安排在精力最好的时段，先完成，再完美。</p>
      </section>
    </main>

    <footer class="app-footer">
      <p>晨光清单 · 数据保存在本地</p>
    </footer>

    <nav class="tab-bar" aria-label="底部导航">
      <a class="active" href="#top">今天</a>
      <a href="#top">统计</a>
      <a href="#top">日历</a>
      <a href="#top">我的</a>
    </nav>
  </div>
</body>
</html>
`,
  `/* 晨光清单 · 移动端原型样式（390px 单列布局，自包含，可自由修改） */
:root {
  --color-primary: #ea580c;
  --color-primary-soft: #ffedd5;
  --color-background: #fff7ed;
  --color-surface: #ffffff;
  --color-text: #431407;
  --color-text-muted: #9a6b4f;
  --color-border: #fde3c8;
  --color-done: #16a34a;
  --font-body: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  --radius-lg: 18px;
  --radius-md: 12px;
  --shadow-card: 0 8px 20px rgba(234, 88, 12, 0.1);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--font-body);
  color: var(--color-text);
  background: linear-gradient(180deg, #ffedd5 0%, #fff7ed 30%);
  line-height: 1.6;
  display: flex;
  justify-content: center;
  min-height: 100vh;
}

/* 390px 单列布局 */
.app {
  width: 100%;
  max-width: 390px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--color-background);
  box-shadow: 0 0 40px rgba(234, 88, 12, 0.12);
}

h1, h2 { margin: 0 0 0.4em; }
p { margin: 0; }
a { text-decoration: none; }

.app-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 20px 12px; }
.app-header h1 { font-size: 24px; }
.app-date { color: var(--color-text-muted); font-size: 14px; }
.app-avatar {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary), #fb923c);
  color: #fff;
  font-weight: 600;
}

main { flex: 1; padding: 8px 20px 96px; display: flex; flex-direction: column; gap: 16px; }

.progress-card, .tip-card { background: var(--color-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-card); padding: 18px; }
.progress-card { background: linear-gradient(135deg, var(--color-primary), #fb923c); color: #fff; }
.progress-label { font-size: 14px; opacity: 0.9; }
.progress-value { font-size: 22px; font-weight: 700; margin: 4px 0 10px; }
.progress-track { height: 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.35); overflow: hidden; }
.progress-fill { width: 60%; height: 100%; border-radius: 999px; background: #fff; }

.task-section h2, .tip-card h2 { font-size: 16px; }
.task-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.task {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  padding: 14px;
}
.task .check {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--color-border);
  color: #fff;
  font-size: 13px;
  flex-shrink: 0;
}
.task.done .check { background: var(--color-done); border-color: var(--color-done); }
.task.done .task-title { text-decoration: line-through; color: var(--color-text-muted); }
.task-title { font-weight: 600; }
.task-time { color: var(--color-text-muted); font-size: 13px; margin-top: 2px; }
.tip-card p { color: var(--color-text-muted); }

.app-footer { padding: 0 20px 12px; text-align: center; }
.app-footer p { color: var(--color-text-muted); font-size: 12px; }

.tab-bar {
  position: sticky;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background: rgba(255, 255, 255, 0.95);
  border-top: 1px solid var(--color-border);
  padding: 10px 8px 18px;
}
.tab-bar a { text-align: center; padding: 8px 0; border-radius: 10px; color: var(--color-text-muted); font-size: 14px; }
.tab-bar a.active { background: var(--color-primary-soft); color: var(--color-primary); font-weight: 600; }

/* 更窄屏幕（如 360px 设备）适配 */
@media (max-width: 360px) {
  main { padding: 8px 14px 96px; }
  .app-header { padding: 16px 14px 8px; }
}
`
);

const showcase = defineTemplate(
  'showcase',
  'Portfolio page',
  'A personal portfolio page with a work grid and about section; images are inline SVG illustrations.',
  `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>山野手记 · 摄影与随笔</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body id="top">
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="#top">山野手记</a>
      <nav class="site-nav" aria-label="主导航">
        <a href="#works">作品</a>
        <a href="#about">关于</a>
        <a href="#top">回到顶部</a>
      </nav>
    </div>
  </header>

  <main>
    <section class="intro">
      <div class="container">
        <h1>把山野的光线和风声，装进画面里</h1>
        <p>这里收录了近三年徒步途中拍下的风景与随手写下的短句，每月更新一次。</p>
      </div>
    </section>

    <section class="works" id="works">
      <div class="container">
        <h2>最新作品</h2>
        <div class="work-grid">
          <figure class="work-card">
            <svg viewBox="0 0 400 260" role="img" aria-label="晨雾山脊插画">
              <defs>
                <linearGradient id="sky-1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bae6fd"/><stop offset="1" stop-color="#f0f9ff"/></linearGradient>
              </defs>
              <rect width="400" height="260" fill="url(#sky-1)"/>
              <path d="M0 200 L120 110 L220 190 L320 120 L400 180 V260 H0 Z" fill="#64748b" opacity="0.75"/>
              <circle cx="320" cy="60" r="26" fill="#fbbf24"/>
            </svg>
            <figcaption>
              <h3>晨雾山脊</h3>
              <p>海拔 2200 米 · 拍摄于川西</p>
            </figcaption>
          </figure>

          <figure class="work-card">
            <svg viewBox="0 0 400 260" role="img" aria-label="湖面倒影插画">
              <defs>
                <linearGradient id="lake-2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#99f6e4"/><stop offset="1" stop-color="#0f766e"/></linearGradient>
              </defs>
              <rect width="400" height="260" fill="url(#lake-2)"/>
              <path d="M60 150 L150 70 L240 150 Z" fill="#134e4a" opacity="0.8"/>
              <path d="M60 160 L150 80 L240 160 Z" fill="#134e4a" opacity="0.35"/>
            </svg>
            <figcaption>
              <h3>湖面倒影</h3>
              <p>清晨六点 · 拍摄于泸沽湖</p>
            </figcaption>
          </figure>

          <figure class="work-card">
            <svg viewBox="0 0 400 260" role="img" aria-label="林间小路插画">
              <defs>
                <linearGradient id="wood-3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#b45309"/></linearGradient>
              </defs>
              <rect width="400" height="260" fill="url(#wood-3)"/>
              <path d="M170 260 Q200 160 190 60 L210 60 Q230 160 230 260 Z" fill="#78350f" opacity="0.85"/>
              <path d="M120 80 Q200 40 280 80" fill="none" stroke="#78350f" stroke-width="8" opacity="0.5"/>
            </svg>
            <figcaption>
              <h3>林间小路</h3>
              <p>秋日午后 · 拍摄于秦岭</p>
            </figcaption>
          </figure>

          <figure class="work-card">
            <svg viewBox="0 0 400 260" role="img" aria-label="雪后营地插画">
              <defs>
                <linearGradient id="snow-4" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e0e7ff"/><stop offset="1" stop-color="#4338ca"/></linearGradient>
              </defs>
              <rect width="400" height="260" fill="url(#snow-4)"/>
              <path d="M140 210 L200 120 L260 210 Z" fill="#312e81"/>
              <circle cx="320" cy="50" r="20" fill="#f9fafb"/>
            </svg>
            <figcaption>
              <h3>雪后营地</h3>
              <p>帐篷外的第一场雪 · 拍摄于四姑娘山</p>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>

    <section class="about" id="about">
      <div class="container about-inner">
        <h2>关于本站</h2>
        <p>我是阿岚，一名周末徒步爱好者。这个页面完全由静态 HTML 与 CSS 组成，把它改成你自己的作品集，只需要替换文字与插画。</p>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container">
      <p>© 2026 山野手记 · 用相机和脚步记录四季</p>
    </div>
  </footer>
</body>
</html>
`,
  `/* 山野手记 · 静态展示页模板样式（自包含，可自由修改） */
:root {
  --color-primary: #b45309;
  --color-primary-dark: #78350f;
  --color-background: #fafaf9;
  --color-surface: #ffffff;
  --color-text: #292524;
  --color-text-muted: #78716c;
  --color-border: #e7e5e4;
  --font-body: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Georgia, serif;
  --radius-lg: 16px;
  --shadow-card: 0 8px 24px rgba(41, 37, 36, 0.1);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--font-body);
  color: var(--color-text);
  background: var(--color-background);
  line-height: 1.8;
}

h1, h2, h3 { line-height: 1.3; margin: 0 0 0.5em; }
p { margin: 0 0 1em; }
a { color: var(--color-primary); text-decoration: none; }
svg { vertical-align: middle; }

.container { width: min(960px, 92vw); margin: 0 auto; }

/* 顶栏 */
.site-header { position: sticky; top: 0; z-index: 10; background: rgba(250, 250, 249, 0.94); border-bottom: 1px solid var(--color-border); }
.header-inner { display: flex; align-items: center; justify-content: space-between; padding: 16px 0; }
.brand { font-size: 20px; font-weight: 700; color: var(--color-text); letter-spacing: 2px; }
.site-nav { display: flex; gap: 22px; }
.site-nav a { color: var(--color-text-muted); font-size: 15px; }
.site-nav a:hover { color: var(--color-primary); }

/* 引言 */
.intro { padding: 88px 0 56px; text-align: center; background: linear-gradient(180deg, rgba(180, 83, 9, 0.08), transparent); }
.intro h1 { font-size: clamp(28px, 4vw, 42px); }
.intro p { max-width: 520px; margin: 0 auto; color: var(--color-text-muted); font-size: 17px; }

/* 图文作品网格 */
.works { padding: 32px 0 72px; }
.works h2 { font-size: 26px; margin-bottom: 28px; }
.work-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 28px; }
.work-card {
  margin: 0;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-card);
}
.work-card svg { display: block; width: 100%; height: auto; }
.work-card figcaption { padding: 18px 20px; }
.work-card h3 { font-size: 18px; margin-bottom: 4px; }
.work-card figcaption p { margin: 0; color: var(--color-text-muted); font-size: 14px; }

/* 关于 */
.about { padding: 0 0 72px; }
.about-inner {
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
  color: #fff;
  border-radius: var(--radius-lg);
  padding: 40px;
}
.about-inner h2 { font-size: 24px; }
.about-inner p { margin: 0; opacity: 0.92; max-width: 640px; }

/* 页脚 */
.site-footer { border-top: 1px solid var(--color-border); padding: 28px 0; color: var(--color-text-muted); font-size: 14px; text-align: center; }
.site-footer p { margin: 0; }

/* 窄屏适配 */
@media (max-width: 720px) {
  .intro { padding: 56px 0 40px; }
  .work-grid { grid-template-columns: 1fr; }
  .about-inner { padding: 28px; }
}
`
);

/** 内置模板目录（顺序固定：landing / dashboard / mobile / showcase）。 */
export const DESIGN_TEMPLATES: readonly DesignTemplateSummary[] = [
  landing,
  dashboard,
  mobile,
  showcase,
].map(({ id, name, description, entry, files, version, source }) => ({
  id,
  name,
  description,
  entry,
  files,
  version,
  source,
}));

/** 按 id 取完整模板定义（含源文件内容）；未知 id 返回 undefined。 */
export function getTemplateDefinition(id: string): TemplateDefinition | undefined {
  return [landing, dashboard, mobile, showcase].find(template => template.id === id);
}
