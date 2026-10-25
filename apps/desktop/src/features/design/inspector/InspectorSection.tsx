import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

export interface InspectorSectionProps {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Optional action rendered at the right of the header (e.g. a count). */
  action?: ReactNode;
}

/**
 * 检查器可折叠分组（P2 §4.5）：button + aria-expanded 头部，内容用
 * grid-rows 动画折叠，折叠时加 `inert` 而不是卸载——表单值与焦点顺序
 * 在开合间保持不变（§3.1 不变量）。
 */
export function InspectorSection({
  id,
  title,
  open,
  onToggle,
  children,
  action,
}: InspectorSectionProps) {
  return (
    <section data-section={id} className="border-b border-border">
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`inspector-section-${id}`}
          onClick={onToggle}
          className="flex h-[34px] min-w-0 flex-1 items-center gap-1.5 px-3 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            size={12}
            strokeWidth={1.75}
            className={`shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
          />
          <span className="min-w-0 flex-1 truncate">{title}</span>
        </button>
        {action ? <div className="shrink-0 pr-2">{action}</div> : null}
      </div>
      <div
        id={`inspector-section-${id}`}
        className={`grid transition-[grid-template-rows] duration-150 ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden" inert={!open}>
          <div className="grid gap-2 px-3 pb-3">{children}</div>
        </div>
      </div>
    </section>
  );
}
