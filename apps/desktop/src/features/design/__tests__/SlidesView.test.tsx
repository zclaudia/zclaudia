import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SlidesView } from '../rail/SlidesView';
import type { SlidesViewProps } from '../rail/SlidesView';
import { addDeckSlide, parseDeck } from '../deck';

/** 三页同父级（可排序）deck 源码。 */
const DECK_SOURCE = `<!doctype html>
<html>
<head><title>deck</title></head>
<body data-zclaudia-deck-ratio="16:9">
  <section data-zclaudia-slide data-title="第一页" data-notes="备注 A">
    <h2>标题一</h2>
  </section>
  <section data-zclaudia-slide data-title="第二页">
    <h2>标题二</h2>
  </section>
  <section data-zclaudia-slide data-title="第三页">第三页</section>
</body>
</html>`;

const PREVIEW_HTML = `<!doctype html><html><head></head><body>
  <section data-zclaudia-slide data-title="第一页"><h2>标题一</h2></section>
  <section data-zclaudia-slide data-title="第二页"><h2>标题二</h2></section>
  <section data-zclaudia-slide data-title="第三页">第三页</section>
</body></html>`;

function mount(overrides: Partial<SlidesViewProps> = {}) {
  const props: SlidesViewProps = {
    active: true,
    page: { path: 'deck/slides.html', source: DECK_SOURCE, busy: false },
    previewHtml: PREVIEW_HTML,
    deck: parseDeck(DECK_SOURCE),
    onCommit: vi.fn().mockResolvedValue(true),
    onPresent: vi.fn(),
    compact: true,
    ...overrides,
  };
  const view = render(<SlidesView {...props} />);
  return {
    ...view,
    props,
    onCommit: props.onCommit as ReturnType<typeof vi.fn>,
    onPresent: props.onPresent as ReturnType<typeof vi.fn>,
  };
}

describe('SlidesView（P5b 左栏内嵌）', () => {
  it('keeps slide editing available without a playback entry on mobile', () => {
    mount({ allowPresent: false });
    expect(screen.queryByRole('button', { name: /Present page/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Notes of page 1' })).toBeEnabled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('active=false 不挂载任何缩略图 iframe（组件保持挂载）', () => {
    mount({ active: false });
    expect(screen.queryByTitle('Thumbnail of page 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add page' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('激活后按页挂载缩略图 iframe 与完整工具条', () => {
    mount();
    expect(screen.getByTitle('Thumbnail of page 1')).toBeInTheDocument();
    expect(screen.getByTitle('Thumbnail of page 2')).toBeInTheDocument();
    expect(screen.getByTitle('Thumbnail of page 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Slide aspect ratio' })).toBeInTheDocument();
    expect(screen.getByText('3/60')).toBeInTheDocument();
  });

  it('隐藏再激活保留展开行与未保存的备注草稿', () => {
    const view = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Notes of page 1' }));
    fireEvent.change(screen.getByLabelText('Notes content of page 1'), {
      target: { value: '尚未保存的备注草稿' },
    });

    view.rerender(<SlidesView {...view.props} active={false} />);
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
    expect(screen.queryByLabelText('Notes content of page 1')).not.toBeInTheDocument();

    view.rerender(<SlidesView {...view.props} active />);
    expect(screen.getByTitle('Thumbnail of page 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes content of page 1')).toHaveValue('尚未保存的备注草稿');
    expect(screen.getByRole('button', { name: 'Notes of page 1' })).toHaveTextContent('Collapse');
  });

  it('无幻灯片标记的陈旧 Slides 页签仍显示可用空态：Add page 写入第一页', async () => {
    const source = '<!doctype html><html><body><p>普通页面</p></body></html>';
    const view = mount({
      page: { path: 'design/plain.html', source, busy: false },
      deck: parseDeck(source),
      previewHtml: null,
    });
    expect(screen.getByText(/This page has no slide markers/)).toBeInTheDocument();
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
    const add = screen.getByRole('button', { name: 'Add page' });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await vi.waitFor(() => expect(view.onCommit).toHaveBeenCalledTimes(1));
    expect(view.onCommit).toHaveBeenCalledWith(addDeckSlide(source).source, 'Add slide');
  });
});
