import { ImagePlay, RefreshCw, Share2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';

export interface DesignToolbarProps {
  /** 活动页路径；null 表示没有打开的页面。 */
  docPath: string | null;
  /** 活动页正在首次载入（status 'loading'；导出不可用）。 */
  loading: boolean;
  busy: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  /** 预览模式（P5 §2.4）：分段按钮「编辑/运行」，aria-pressed 反映当前态。 */
  previewMode: 'edit' | 'run';
  onPreviewModeChange: (mode: 'edit' | 'run') => void;
  /** 活动页含幻灯片标记（P5 §3.1）时「幻灯片」可用。 */
  deckAvailable: boolean;
  /** 打开幻灯片面板。 */
  onDeck: () => void;
  /** 打开渲染导出对话框（需存在打开且非 loading 的活动页）。 */
  onRenderExport: () => void;
  /** 运行模式（P5 只读体验）：「交给 Agent 修改」禁用。 */
  runMode: boolean;
  /** 总览开关状态（开关按钮用 aria-pressed 反映）。 */
  overviewOpen: boolean;
  onToggleOverview: () => void;
  /** 结构树开关状态（P3 §7.2，样式对齐「总览」按钮）。 */
  treeOpen: boolean;
  onToggleTree: () => void;
  /** 打开导出对话框（需存在打开且非 loading 的活动页）。 */
  onExport: () => void;
  /** 打开未保存差异视图（仅活动页 dirty 时可用）。 */
  onToggleDiff: () => void;
  /** 打开分享面板（P7 §7.2，需存在打开且非 loading 的活动页）。 */
  onShare: () => void;
  /** 打开模板对话框（P4 §2.4，与活动页无关）。 */
  onTemplates: () => void;
  /** 打开品牌面板（P4 §3.4，与活动页无关）。 */
  onBrand: () => void;
  /** 打开素材库（P4 §4.2，与活动页无关）。 */
  onAssets: () => void;
  /** 打开媒体生成面板（P6 §8.3，与活动页无关）。 */
  onMedia: () => void;
  onRefresh: () => void;
  onGenerate: () => void;
  onHandoff: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onReload: () => void;
}

/** 工具栏：文件选择由标签条承担；这里保留刷新/模式/历史/保存/交接并作用于活动页。 */
export function DesignToolbar({
  docPath,
  loading,
  busy,
  dirty,
  canUndo,
  canRedo,
  hasSelection,
  previewMode,
  onPreviewModeChange,
  deckAvailable,
  onDeck,
  onRenderExport,
  runMode,
  overviewOpen,
  onToggleOverview,
  treeOpen,
  onToggleTree,
  onExport,
  onToggleDiff,
  onShare,
  onTemplates,
  onBrand,
  onAssets,
  onMedia,
  onRefresh,
  onGenerate,
  onHandoff,
  onUndo,
  onRedo,
  onSave,
  onReload,
}: DesignToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
      <div className="flex items-center gap-1">
        <Button size="sm" onClick={onTemplates} aria-label="模板">
          模板
        </Button>
        <Button size="sm" onClick={onBrand} aria-label="品牌">
          品牌
        </Button>
        <Button size="sm" onClick={onAssets} aria-label="素材">
          素材
        </Button>
        <Button size="sm" onClick={onMedia} aria-label="媒体">
          <ImagePlay size={13} />
          媒体
        </Button>
      </div>
      <Button size="sm" onClick={onRefresh} aria-label="刷新设计文件">
        <RefreshCw size={13} />
      </Button>
      <div className="flex items-center gap-1" role="group" aria-label="预览模式">
        <Button
          size="sm"
          onClick={() => onPreviewModeChange('edit')}
          aria-label="编辑模式"
          aria-pressed={previewMode === 'edit'}
          variant={previewMode === 'edit' ? 'primary' : 'ghost'}
        >
          编辑
        </Button>
        <Button
          size="sm"
          onClick={() => onPreviewModeChange('run')}
          aria-label="运行模式"
          aria-pressed={previewMode === 'run'}
          variant={previewMode === 'run' ? 'primary' : 'ghost'}
        >
          运行
        </Button>
      </div>
      <Button size="sm" onClick={onUndo} disabled={!canUndo || busy} aria-label="撤销">
        撤销
      </Button>
      <Button size="sm" onClick={onRedo} disabled={!canRedo || busy} aria-label="重做">
        重做
      </Button>
      <Button size="sm" onClick={onGenerate} disabled={dirty}>
        生成页面
      </Button>
      <Button
        size="sm"
        onClick={onHandoff}
        disabled={!hasSelection || !docPath || dirty || busy || runMode}
        title={runMode ? '运行模式仅供交互体验；请切回编辑模式后再交给 Agent' : undefined}
      >
        交给 Agent 修改
      </Button>
      <Button size="sm" variant="primary" onClick={onSave} disabled={!dirty || busy}>
        保存
      </Button>
      <Button size="sm" onClick={onReload} disabled={!docPath || busy}>
        重新载入
      </Button>
      <Button
        size="sm"
        onClick={onToggleOverview}
        aria-label="总览"
        aria-pressed={overviewOpen}
        variant={overviewOpen ? 'primary' : 'ghost'}
      >
        总览
      </Button>
      <Button
        size="sm"
        onClick={onToggleTree}
        aria-label="结构树"
        aria-pressed={treeOpen}
        variant={treeOpen ? 'primary' : 'ghost'}
      >
        结构树
      </Button>
      <Button
        size="sm"
        onClick={onExport}
        disabled={!docPath || loading}
        aria-label="导出"
        title={docPath ? '把页面与本地资源打包为 ZIP' : undefined}
      >
        导出
      </Button>
      <Button
        size="sm"
        onClick={onDeck}
        disabled={!deckAvailable}
        aria-label="幻灯片"
        title={deckAvailable ? '打开幻灯片面板' : '当前页没有幻灯片标记（data-zclaudia-slide）'}
      >
        幻灯片
      </Button>
      <Button
        size="sm"
        onClick={onRenderExport}
        disabled={!docPath || loading}
        aria-label="渲染导出"
        title={docPath ? '把当前预览渲染导出为 PNG/PDF（整页图片）' : undefined}
      >
        渲染导出
      </Button>
      <Button size="sm" onClick={onToggleDiff} disabled={!dirty} aria-label="未保存差异">
        未保存差异
      </Button>
      <Button
        size="sm"
        onClick={onShare}
        disabled={!docPath || loading}
        aria-label="分享"
        title={docPath ? '创建分享链接并查看审阅评论' : undefined}
      >
        <Share2 size={13} />
        分享
      </Button>
    </div>
  );
}
