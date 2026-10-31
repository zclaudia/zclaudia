import { useCallback, useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { DesignTier } from './tiers';

export interface DesignWorkbenchProps {
  tier: DesignTier;
  compact: boolean;
  touch?: boolean;
  /** 组合根实测高度（窄档用于计算底部面板高度，避免挤占画布）。 */
  height?: number;
  leftOpen: boolean;
  rightOpen: boolean;
  leftWidth: number;
  topBar: ReactNode;
  rail: ReactNode;
  canvas: ReactNode;
  inspector: ReactNode;
  statusBar: ReactNode;
  /** 中档/窄档抽屉关闭（Esc / 点画布）。 */
  onCloseDrawer: () => void;
}

/**
 * 工作台骨架（P1 §3.1）：topbar / rail / canvas / inspector / status 五块
 * 固定同级节点，三档只改变 grid 模板与定位——画布节点身份不变，切档、
 * 开合面板、切页签都不会重挂载 iframe。
 */
export function DesignWorkbench({
  tier,
  compact,
  touch = false,
  height = 0,
  leftOpen,
  rightOpen,
  leftWidth,
  topBar,
  rail,
  canvas,
  inspector,
  statusBar,
  onCloseDrawer,
}: DesignWorkbenchProps) {
  const narrow = tier === 'narrow';
  const overlayDrawer = tier !== 'wide' && leftOpen;

  /** 关闭覆盖式抽屉，焦点回到打开它的按钮。 */
  const closeDrawer = useCallback(() => {
    const trigger =
      document.querySelector<HTMLElement>('[aria-label="Toggle pages panel"]') ??
      document.querySelector<HTMLElement>('[data-testid="design-rail"] [aria-pressed="true"]');
    onCloseDrawer();
    requestAnimationFrame(() => trigger?.focus());
  }, [onCloseDrawer]);

  useEffect(() => {
    if (!overlayDrawer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [overlayDrawer, closeDrawer]);

  // 窄档底部面板：目标 45%（上限 420），但至少给画布留 96px；
  // 面板本身很矮（工具面板最小内容区 120px）时退化为 76px peek，绝不让
  // 两个 grid 行的最小高度之和超过可用高度。
  const mainHeight = Math.max(0, height - 44 - (touch ? 44 : 26));
  const inspectorRow = rightOpen
    ? Math.max(
        76,
        Math.min(420, Math.max(96, Math.round(mainHeight * 0.45)), Math.max(76, mainHeight - 96))
      )
    : 76;
  const gridStyle: CSSProperties = narrow
    ? {
        gridTemplateColumns: 'minmax(0, 1fr)',
        gridTemplateRows: `minmax(0, 1fr) ${inspectorRow}px`,
      }
    : {
        gridTemplateColumns: `${
          tier === 'wide' && leftOpen ? 40 + leftWidth : 40
        }px minmax(0, 1fr) ${rightOpen ? (tier === 'wide' ? 300 : 280) : 0}px`,
        gridTemplateRows: 'minmax(0, 1fr)',
      };

  return (
    <div
      data-testid="design-workbench"
      data-tier={tier}
      data-compact={compact}
      className="relative flex h-full min-h-0 flex-col"
    >
      {topBar}
      <div
        data-testid="design-workbench-main"
        className="relative grid min-h-0 flex-1"
        style={gridStyle}
      >
        {overlayDrawer && (
          <button
            type="button"
            aria-label="Close panels"
            tabIndex={-1}
            onClick={closeDrawer}
            className="absolute z-dropdown cursor-default bg-foreground/10"
            style={narrow ? { inset: 0 } : { gridColumn: '2 / -1', gridRow: 1, inset: 0 }}
          />
        )}
        <div
          className={narrow ? 'contents' : 'flex min-h-0 min-w-0'}
          style={narrow ? undefined : { gridColumn: 1, gridRow: 1 }}
        >
          {rail}
        </div>
        <div
          className="relative flex min-h-0 min-w-0 flex-col"
          style={narrow ? { gridColumn: 1, gridRow: 1 } : { gridColumn: 2, gridRow: 1 }}
        >
          {canvas}
        </div>
        <div
          className={`min-h-0 min-w-0 overflow-hidden ${
            narrow ? 'rounded-t-2xl border-t border-border bg-background' : 'border-l border-border'
          }`}
          style={narrow ? { gridColumn: 1, gridRow: 2 } : { gridColumn: 3, gridRow: 1 }}
        >
          {inspector}
        </div>
      </div>
      {statusBar}
    </div>
  );
}
