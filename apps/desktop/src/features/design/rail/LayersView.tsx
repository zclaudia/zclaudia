import { Info } from 'lucide-react';
import { IconButton } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { ElementTree } from '../components/ElementTree';

/** Layers 头部的能力边界说明：树由页面源码构建，不含伪元素与脚本生成内容。 */
const LAYERS_HELP =
  'Built from the page source; pseudo-elements and script-generated content do not appear here.';

export interface LayersViewProps {
  /** 活动页草稿源码；变化即重建（ElementTree 内 useMemo(source)）。 */
  source: string;
  /** 当前选区路径；与节点路径深相等的行高亮。 */
  selectionPath: number[] | null;
  /** 点击行 → 向预览桥接请求选择该元素。 */
  onSelectPath: (path: number[]) => void;
}

/**
 * 左栏 Layers 视图（P4 §4.6）：承载 ElementTree（去掉原 max-h-56 限制，随
 * 面板滚动），能力边界说明从树内横幅改为头部 info Tooltip。
 */
export function LayersView({ source, selectionPath, onSelectPath }: LayersViewProps): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 bg-background/40 px-2">
        <span className="flex-1" />
        <Tooltip content={LAYERS_HELP}>
          <IconButton size="sm" aria-label="Layers help">
            <Info size={12} strokeWidth={1.75} />
          </IconButton>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <ElementTree source={source} selectionPath={selectionPath} onSelectPath={onSelectPath} />
      </div>
    </div>
  );
}
