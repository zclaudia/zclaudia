import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { FIELD_CLASS, Input } from '../../../components/ui/Input';
import { useFileViewerStore } from '../../../stores/fileViewerStore';
import { elementLineRange } from '../workspace/source-lines';
import type { DesignEditOperation, DesignSelection } from '../types';

const OVERRIDE_WARNING =
  '修改已写入源码，但计算样式仍被外部样式覆盖（如 !important）；已按内联声明写入，未提高优先级。';
const LINE_OFFSET_HINT = '文件查看器显示已保存版本，行号以草稿计算可能有偏移';
const LOCATE_ERROR = '无法定位源码位置';

export interface SelectionEditorProps {
  selection: DesignSelection | null;
  busy: boolean;
  overrideWarning: boolean;
  /** 活动页草稿全文；源码行号以草稿计算。null 时禁用「查看源码」。 */
  docSource: string | null;
  /** 活动页工作区相对路径（fileViewer 的打开入口）。 */
  docPath: string | null;
  /** 活动页是否 dirty：fileViewer 只显示磁盘版本，行号可能有偏移。 */
  dirty: boolean;
  /** fileViewer 入参（workspace 工具上下文经 props 传入）。 */
  projectRoot?: string;
  backendId?: string;
  onApply: (operations: DesignEditOperation[]) => void;
}

/** Form for the element selected in the preview: text, colors, apply and per-color clear. */
export function SelectionEditor({
  selection,
  busy,
  overrideWarning,
  docSource,
  docPath,
  dirty,
  projectRoot,
  backendId,
  onApply,
}: SelectionEditorProps) {
  const [textValue, setTextValue] = useState('');
  const [colorValue, setColorValue] = useState('');
  const [backgroundValue, setBackgroundValue] = useState('');
  /** 定位失败的选区；仅对发起跳转的那次选区显示错误，选区变化即失效。 */
  const [locateFailed, setLocateFailed] = useState<DesignSelection | null>(null);

  useEffect(() => {
    setTextValue(selection?.sourceText ?? selection?.text ?? '');
    setColorValue(selection?.color ?? '');
    setBackgroundValue(selection?.backgroundColor ?? '');
  }, [selection]);

  if (!selection) {
    return (
      <section className="flex flex-col gap-3" aria-label="选中元素">
        <div className="text-[11px] font-medium text-muted-foreground">选中元素</div>
        <p className="text-xs text-muted-foreground">
          点击预览中的元素进行编辑。预览面向静态 HTML/CSS；请勿依赖 JavaScript 渲染或 CDN
          外链资源。
        </p>
      </section>
    );
  }

  const buildOperations = (): DesignEditOperation[] => {
    const operations: DesignEditOperation[] = [];
    if (textValue !== (selection.sourceText ?? selection.text)) {
      operations.push({ kind: 'text', value: textValue });
    }
    if (colorValue.trim() && colorValue !== (selection.color ?? '')) {
      operations.push({ kind: 'style', property: 'color', value: colorValue });
    }
    if (backgroundValue.trim() && backgroundValue !== (selection.backgroundColor ?? '')) {
      operations.push({ kind: 'style', property: 'background-color', value: backgroundValue });
    }
    return operations;
  };

  /** 查看源码（P2 §5.2）：行号基于草稿计算；fileViewer 永远显示磁盘版本。 */
  const viewSource = () => {
    if (!docSource || !docPath) return;
    const range = elementLineRange(
      docSource,
      selection.elementPath,
      selection.tagName,
      selection.sourceText
    );
    if (!range) {
      setLocateFailed(selection);
      return;
    }
    setLocateFailed(null);
    useFileViewerStore
      .getState()
      .openFile(projectRoot ?? '', docPath, range.startLine, range.endLine, backendId);
  };

  return (
    <section className="flex flex-col gap-3" aria-label="选中元素">
      <div className="text-[11px] font-medium text-muted-foreground">选中元素</div>
      <div className="font-mono text-xs text-muted-foreground">
        &lt;{selection.tagName}&gt; · {selection.elementPath.join('.')}
      </div>
      {overrideWarning && (
        <div role="status" className="text-xs text-warning">
          {OVERRIDE_WARNING}
        </div>
      )}
      <label className="grid gap-1 text-xs">
        文字
        <textarea
          aria-label="元素文字"
          className={`${FIELD_CLASS} resize-y`}
          rows={2}
          value={textValue}
          onChange={e => setTextValue(e.target.value)}
        />
      </label>
      <div className="grid gap-1 text-xs">
        <span>文字颜色</span>
        <div className="flex items-center gap-1">
          <Input
            aria-label="文字颜色"
            value={colorValue}
            placeholder="#000000"
            onChange={e => setColorValue(e.target.value)}
          />
          <Button
            size="sm"
            className="shrink-0"
            disabled={busy}
            aria-label="清除文字颜色"
            onClick={() => onApply([{ kind: 'style', property: 'color', value: null }])}
          >
            清除文字颜色
          </Button>
        </div>
      </div>
      <div className="grid gap-1 text-xs">
        <span>背景颜色</span>
        <div className="flex items-center gap-1">
          <Input
            aria-label="背景颜色"
            value={backgroundValue}
            placeholder="transparent"
            onChange={e => setBackgroundValue(e.target.value)}
          />
          <Button
            size="sm"
            className="shrink-0"
            disabled={busy}
            aria-label="清除背景颜色"
            onClick={() => onApply([{ kind: 'style', property: 'background-color', value: null }])}
          >
            清除背景颜色
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={() => onApply(buildOperations())}
          disabled={busy}
        >
          应用修改
        </Button>
        <Button
          size="sm"
          onClick={viewSource}
          disabled={busy || !docSource || !docPath}
          aria-label="查看源码"
        >
          查看源码
        </Button>
      </div>
      {locateFailed === selection && (
        <div role="alert" className="text-xs text-destructive">
          {LOCATE_ERROR}
        </div>
      )}
      {dirty && <div className="text-[10px] text-muted-foreground">{LINE_OFFSET_HINT}</div>}
    </section>
  );
}
