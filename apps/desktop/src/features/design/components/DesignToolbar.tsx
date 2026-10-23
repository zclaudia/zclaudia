import { RefreshCw } from 'lucide-react';
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
  /** 总览开关状态（开关按钮用 aria-pressed 反映）。 */
  overviewOpen: boolean;
  onToggleOverview: () => void;
  /** 打开导出对话框（需存在打开且非 loading 的活动页）。 */
  onExport: () => void;
  /** 打开未保存差异视图（仅活动页 dirty 时可用）。 */
  onToggleDiff: () => void;
  onRefresh: () => void;
  onGenerate: () => void;
  onHandoff: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onReload: () => void;
}

/** 工具栏：文件选择由标签条承担；这里保留刷新/历史/保存/交接并作用于活动页。 */
export function DesignToolbar({
  docPath,
  loading,
  busy,
  dirty,
  canUndo,
  canRedo,
  hasSelection,
  overviewOpen,
  onToggleOverview,
  onExport,
  onToggleDiff,
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
      <Button size="sm" onClick={onRefresh} aria-label="刷新设计文件">
        <RefreshCw size={13} />
      </Button>
      <Button size="sm" onClick={onUndo} disabled={!canUndo || busy} aria-label="撤销">
        撤销
      </Button>
      <Button size="sm" onClick={onRedo} disabled={!canRedo || busy} aria-label="重做">
        重做
      </Button>
      <Button size="sm" onClick={onGenerate} disabled={dirty}>
        生成页面
      </Button>
      <Button size="sm" onClick={onHandoff} disabled={!hasSelection || !docPath || dirty || busy}>
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
        onClick={onExport}
        disabled={!docPath || loading}
        aria-label="导出"
        title={docPath ? '把页面与本地资源打包为 ZIP' : undefined}
      >
        导出
      </Button>
      <Button size="sm" onClick={onToggleDiff} disabled={!dirty} aria-label="未保存差异">
        未保存差异
      </Button>
    </div>
  );
}
