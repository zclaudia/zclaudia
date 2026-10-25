import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { DesignWorkbench } from '../layout/DesignWorkbench';
import { PreviewCanvas } from '../components/PreviewCanvas';
import type { DesignTier } from '../layout/tiers';

function Harness({
  tier,
  height = 0,
  leftOpen = true,
  rightOpen = true,
  onCloseDrawer = () => undefined,
}: {
  tier: DesignTier;
  height?: number;
  leftOpen?: boolean;
  rightOpen?: boolean;
  onCloseDrawer?: () => void;
}) {
  const [loads, setLoads] = useState(0);
  return (
    <div>
      <div data-testid="load-count">{loads}</div>
      <DesignWorkbench
        tier={tier}
        compact={tier !== 'wide'}
        height={height}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        leftWidth={240}
        onCloseDrawer={onCloseDrawer}
        topBar={<div data-testid="topbar">top</div>}
        rail={<div data-testid="rail">rail</div>}
        canvas={
          <PreviewCanvas
            srcDoc="<html><body>p</body></html>"
            viewport={{ preset: 'desktop', width: 1280 }}
            zoom={{ mode: 'manual', value: 1 }}
            onFrameLoad={() => setLoads(value => value + 1)}
            className="h-full"
          />
        }
        inspector={<div data-testid="inspector">inspector</div>}
        statusBar={<div data-testid="statusbar">status</div>}
      />
    </div>
  );
}

describe('DesignWorkbench（P1 三档骨架）', () => {
  it('三档都渲染 topbar / rail / canvas / inspector / status 五个节点', () => {
    const view = render(<Harness tier="wide" />);
    for (const tier of ['wide', 'medium', 'narrow'] as const) {
      view.rerender(<Harness tier={tier} />);
      expect(screen.getByTestId('design-workbench')).toHaveAttribute('data-tier', tier);
      expect(screen.getByTestId('topbar')).toBeInTheDocument();
      expect(screen.getByTestId('rail')).toBeInTheDocument();
      expect(screen.getByTitle('Design preview')).toBeInTheDocument();
      expect(screen.getByTestId('inspector')).toBeInTheDocument();
      expect(screen.getByTestId('statusbar')).toBeInTheDocument();
    }
  });

  it('切档不重挂载画布 iframe（节点身份不变、不触发 load）', () => {
    const view = render(<Harness tier="wide" />);
    const frame = screen.getByTitle('Design preview');
    expect(screen.getByTestId('load-count')).toHaveTextContent('0');

    view.rerender(<Harness tier="medium" />);
    expect(screen.getByTitle('Design preview')).toBe(frame);
    view.rerender(<Harness tier="narrow" />);
    expect(screen.getByTitle('Design preview')).toBe(frame);
    view.rerender(<Harness tier="wide" />);
    expect(screen.getByTitle('Design preview')).toBe(frame);
    expect(screen.getByTestId('load-count')).toHaveTextContent('0');
  });

  it('开合左栏 / 检查器不重挂载画布', () => {
    const view = render(<Harness tier="wide" />);
    const frame = screen.getByTitle('Design preview');
    view.rerender(<Harness tier="wide" leftOpen={false} />);
    expect(screen.getByTitle('Design preview')).toBe(frame);
    view.rerender(<Harness tier="wide" leftOpen rightOpen={false} />);
    expect(screen.getByTitle('Design preview')).toBe(frame);
    expect(screen.getByTestId('load-count')).toHaveTextContent('0');
  });

  it('窄档抽屉打开时渲染遮罩，Esc 触发关闭', () => {
    const onCloseDrawer = vi.fn();
    render(<Harness tier="narrow" onCloseDrawer={onCloseDrawer} />);
    expect(screen.getByRole('button', { name: 'Close panels' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseDrawer).toHaveBeenCalledTimes(1);
  });

  it('中档抽屉打开时同样有遮罩，Esc 触发关闭', () => {
    const onCloseDrawer = vi.fn();
    render(<Harness tier="medium" leftOpen onCloseDrawer={onCloseDrawer} />);
    expect(screen.getByRole('button', { name: 'Close panels' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseDrawer).toHaveBeenCalledTimes(1);
  });

  it('宽档不渲染抽屉遮罩', () => {
    render(<Harness tier="wide" />);
    expect(screen.queryByRole('button', { name: 'Close panels' })).not.toBeInTheDocument();
  });

  it('窄档底部面板高度按可用高度收敛：矮面板退化为 76px peek', () => {
    const view = render(<Harness tier="narrow" />);
    // height 默认 0：mainHeight = 0 → 76px。
    expect(screen.getByTestId('design-workbench-main').style.gridTemplateRows).toBe(
      'minmax(0, 1fr) 76px'
    );
    view.rerender(<Harness tier="narrow" height={400} />);
    // mainHeight = 400-44-26 = 330；45% = 149，且给画布留 96px → 149px。
    expect(screen.getByTestId('design-workbench-main').style.gridTemplateRows).toBe(
      'minmax(0, 1fr) 149px'
    );
    view.rerender(<Harness tier="narrow" height={200} />);
    // mainHeight = 130；45% = 59 < 96，且最多只能留 76px → 76px。
    expect(screen.getByTestId('design-workbench-main').style.gridTemplateRows).toBe(
      'minmax(0, 1fr) 76px'
    );
  });
});
