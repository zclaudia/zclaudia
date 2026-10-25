import type { JSX } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton } from '../../../components/ui/Button';
import { TONE_DOT } from '../../../components/ui/tone';
import type { DesignNotice } from '../hooks/useDesignNotices';

/**
 * 设计工作台面板内通知栈：绝对定位于面板右上角的浮层列表，每条带语义色
 * 圆点、正文、可选动作与关闭钮。容器只负责布局并放行鼠标事件
 * （pointer-events-none），命中区域收敛到每张卡片本身（pointer-events-auto）。
 * 颜色一律走语义 token（TONE_DOT），不做裸色。
 */
export function NoticeStack({
  notices,
  onDismiss,
  className = '',
}: {
  notices: DesignNotice[];
  onDismiss: (id: string) => void;
  className?: string;
}): JSX.Element | null {
  if (notices.length === 0) return null;
  return (
    <div
      className={`pointer-events-none absolute right-3 top-3 z-dropdown flex w-72 max-w-[calc(100%-24px)] flex-col gap-1.5 ${className}`.trim()}
    >
      {notices.map(notice => (
        <div
          key={notice.id}
          role="status"
          className="pointer-events-auto flex items-start gap-2 rounded-xl border border-border/60 bg-popover/95 px-3 py-2 text-[11px] text-foreground shadow-apple-lg glass"
        >
          <span
            aria-hidden
            className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[notice.tone ?? 'neutral']}`}
          />
          <span className="flex-1 leading-4">{notice.text}</span>
          {notice.actions?.map(action => (
            <Button key={action.label} size="sm" onClick={action.onSelect}>
              {action.label}
            </Button>
          ))}
          <IconButton
            size="sm"
            aria-label={`Dismiss notice: ${notice.text}`}
            onClick={() => onDismiss(notice.id)}
          >
            <X size={12} strokeWidth={1.75} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
