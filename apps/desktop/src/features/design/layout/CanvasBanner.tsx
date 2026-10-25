/**
 * 画布顶部的阻断提示条（warning/destructive 各一行，颜色仅承载语义）。
 */

export interface CanvasBannerItem {
  id: string;
  tone: 'warning' | 'destructive';
  text: string;
  /** 缺省时 destructive → alert，warning → status。 */
  role?: 'status' | 'alert';
}

const TONE_TEXT_CLASS: Record<CanvasBannerItem['tone'], string> = {
  warning: 'text-warning',
  destructive: 'text-destructive',
};

export function CanvasBanner({ items }: { items: CanvasBannerItem[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <>
      {items.map(item => (
        <div
          key={item.id}
          role={item.role ?? (item.tone === 'destructive' ? 'alert' : 'status')}
          className={`flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] ${TONE_TEXT_CLASS[item.tone]}`}
        >
          {item.text}
        </div>
      ))}
    </>
  );
}
