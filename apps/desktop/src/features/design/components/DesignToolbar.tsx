import { RefreshCw } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Select';

export interface DesignToolbarProps {
  docPath: string | null;
  files: string[];
  busy: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  onFileSelect: (path: string) => void;
  onRefresh: () => void;
  onGenerate: () => void;
  onHandoff: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onReload: () => void;
}

/** Toolbar of the design panel: file discovery, history, save and agent handoff. */
export function DesignToolbar({
  docPath,
  files,
  busy,
  dirty,
  canUndo,
  canRedo,
  hasSelection,
  onFileSelect,
  onRefresh,
  onGenerate,
  onHandoff,
  onUndo,
  onRedo,
  onSave,
  onReload,
}: DesignToolbarProps) {
  const options = files.map(path => ({ value: path, label: path }));
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
      <Select
        value={docPath ?? ''}
        onChange={onFileSelect}
        options={options}
        placeholder="选择 HTML 文件"
        disabled={dirty || busy || files.length === 0}
        ariaLabel="设计文件"
        size="sm"
        className="min-w-36 flex-1"
      />
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
    </div>
  );
}
