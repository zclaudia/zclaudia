import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DeckPanel } from '../components/DeckPanel';
import type { DeckPanelProps } from '../components/DeckPanel';
import {
  addDeckSlide,
  deleteDeckSlide,
  parseDeck,
  reorderDeckSlides,
  setDeckRatio,
  updateDeckSlideNotes,
  updateDeckSlideTitle,
} from '../deck';

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

/** 标记元素分属不同父级（不可排序）。 */
const NESTED_SOURCE = `<!doctype html>
<html>
<body>
  <div class="wrap">
    <section data-zclaudia-slide data-title="容器一">A</section>
    <section data-zclaudia-slide data-title="容器二">B</section>
  </div>
  <section data-zclaudia-slide data-title="游离页">C</section>
</body>
</html>`;

const PREVIEW_HTML = `<!doctype html><html><head></head><body>
  <section data-zclaudia-slide data-title="第一页"><h2>标题一</h2></section>
  <section data-zclaudia-slide data-title="第二页"><h2>标题二</h2></section>
  <section data-zclaudia-slide data-title="第三页">第三页</section>
</body></html>`;

function mount(overrides: Partial<DeckPanelProps> = {}) {
  const props: DeckPanelProps = {
    open: true,
    page: { path: 'deck/slides.html', source: DECK_SOURCE, busy: false },
    previewHtml: PREVIEW_HTML,
    deck: parseDeck(DECK_SOURCE),
    onCommit: vi.fn().mockResolvedValue(true),
    onPresent: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<DeckPanel {...props} />);
  return {
    onCommit: props.onCommit as ReturnType<typeof vi.fn>,
    onPresent: props.onPresent as ReturnType<typeof vi.fn>,
    onClose: props.onClose as ReturnType<typeof vi.fn>,
  };
}

describe('DeckPanel（P5 §5.1）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('每页渲染一张缩略图 iframe 与页卡控件，页数显示 N/60', () => {
    mount();
    expect(screen.getByTitle('Thumbnail of page 1')).toBeInTheDocument();
    expect(screen.getByTitle('Thumbnail of page 2')).toBeInTheDocument();
    expect(screen.getByTitle('Thumbnail of page 3')).toBeInTheDocument();
    expect(screen.getByLabelText('Title of page 1')).toHaveValue('第一页');
    expect(screen.getByLabelText('Title of page 3')).toHaveValue('第三页');
    expect(screen.getByText('3/60')).toBeInTheDocument();
  });

  it('previewHtml 为 null 时缩略图显示占位', () => {
    mount({ previewHtml: null });
    expect(screen.queryByTitle('Thumbnail of page 1')).not.toBeInTheDocument();
    expect(screen.getAllByText('Building preview…')).toHaveLength(3);
  });

  it('上移/下移调用 onCommit 且参数为 reorder 结果；首末页边界禁用', async () => {
    const h = mount();
    const upFirst = screen.getByRole('button', { name: 'Move page 1 up' });
    expect(upFirst).toBeDisabled();
    expect(upFirst).toHaveAttribute('title', 'Already the first page');
    expect(screen.getByRole('button', { name: 'Move page 3 down' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Move page 2 up' }));
    await waitFor(() => expect(h.onCommit).toHaveBeenCalledTimes(1));
    expect(h.onCommit).toHaveBeenCalledWith(reorderDeckSlides(DECK_SOURCE, 1, 0), 'Move page 2 up');

    // 连续操作以乐观更新后的本地 source 为基线（§5.1「以返回的 source 重建本地视图」）。
    const afterUp = reorderDeckSlides(DECK_SOURCE, 1, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Move page 1 down' }));
    await waitFor(() => expect(h.onCommit).toHaveBeenCalledTimes(2));
    expect(h.onCommit).toHaveBeenLastCalledWith(reorderDeckSlides(afterUp, 0, 1), 'Move page 1 down');
  });

  it('标记元素非同父级时排序按钮禁用并显示原因', () => {
    mount({
      page: { path: 'deck/nested.html', source: NESTED_SOURCE, busy: false },
      deck: parseDeck(NESTED_SOURCE),
    });
    const up = screen.getByRole('button', { name: 'Move page 1 up' });
    expect(up).toBeDisabled();
    expect(up).toHaveAttribute('title', 'Slides are not under the same parent and cannot be reordered');
    expect(screen.getByRole('button', { name: 'Move page 1 down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move page 3 down' })).toBeDisabled();
  });

  it('修改标题经 updateDeckSlideTitle 提交', async () => {
    const h = mount();
    fireEvent.change(screen.getByLabelText('Title of page 1'), { target: { value: '新标题' } });
    await waitFor(() => expect(h.onCommit).toHaveBeenCalledTimes(1));
    expect(h.onCommit).toHaveBeenCalledWith(
      updateDeckSlideTitle(DECK_SOURCE, 0, '新标题'),
      'Edit title of page 1'
    );
  });

  it('标题超长时纯函数抛错：页内 alert 显示且不提交', async () => {
    const h = mount();
    fireEvent.change(screen.getByLabelText('Title of page 1'), {
      target: { value: '长'.repeat(201) },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Title must be at most 200 characters');
    expect(h.onCommit).not.toHaveBeenCalled();
  });

  it('备注展开后可编辑并经 updateDeckSlideNotes 保存', async () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Notes of page 1' }));
    const textarea = screen.getByLabelText('Notes content of page 1');
    expect(textarea).toHaveValue('备注 A');
    fireEvent.change(textarea, { target: { value: '更新后的备注' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save notes of page 1' }));
    await waitFor(() => expect(h.onCommit).toHaveBeenCalledTimes(1));
    expect(h.onCommit).toHaveBeenCalledWith(
      updateDeckSlideNotes(DECK_SOURCE, 0, '更新后的备注'),
      'Edit notes of page 1'
    );
  });

  it('备注超过 2000 字时禁用保存并显示计数', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Notes of page 1' }));
    fireEvent.change(screen.getByLabelText('Notes content of page 1'), {
      target: { value: 'n'.repeat(2001) },
    });
    expect(screen.getByRole('button', { name: 'Save notes of page 1' })).toBeDisabled();
    expect(screen.getByText('2001/2000')).toBeInTheDocument();
  });

  it('新增页经 addDeckSlide 提交', async () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    await waitFor(() => expect(h.onCommit).toHaveBeenCalledTimes(1));
    expect(h.onCommit).toHaveBeenCalledWith(addDeckSlide(DECK_SOURCE).source, 'Add slide');
  });

  it('删除需二次确认：确认后经 deleteDeckSlide 提交', async () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete page 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete slide' });
    expect(h.onCommit).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm deleting page 2' }));
    await waitFor(() => expect(h.onCommit).toHaveBeenCalledTimes(1));
    expect(h.onCommit).toHaveBeenCalledWith(deleteDeckSlide(DECK_SOURCE, 1), 'Delete page 2');
  });

  it('删除二次确认可取消：不提交', () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete page 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete slide' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(h.onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Delete slide' })).not.toBeInTheDocument();
  });

  it('比例切换经 setDeckRatio 提交', async () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Slide aspect ratio' }));
    fireEvent.click(screen.getByRole('option', { name: '4:3' }));
    await waitFor(() => expect(h.onCommit).toHaveBeenCalledTimes(1));
    expect(h.onCommit).toHaveBeenCalledWith(setDeckRatio(DECK_SOURCE, '4:3'), 'Set slide aspect ratio to 4:3');
  });

  it('onCommit 返回 false 时页内 alert 显示提交失败', async () => {
    const h = mount({ onCommit: vi.fn().mockResolvedValue(false) });
    fireEvent.click(screen.getByRole('button', { name: 'Move page 1 down' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The change did not take effect');
    expect(h.onCommit).toHaveBeenCalledWith(reorderDeckSlides(DECK_SOURCE, 0, 1), 'Move page 1 down');
  });

  it('busy 时全部操作禁用', () => {
    mount({ page: { path: 'deck/slides.html', source: DECK_SOURCE, busy: true } });
    expect(screen.getByLabelText('Title of page 1')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move page 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move page 1 down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete page 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Present page 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Notes of page 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Slide aspect ratio' })).toBeDisabled();
  });

  it('已达 60 页上限时禁用新增页并提示', () => {
    const body = Array.from(
      { length: 60 },
      (_, i) => `  <section data-zclaudia-slide data-title="第 ${i + 1} 页">内容</section>`
    ).join('\n');
    const source = `<!doctype html>\n<html>\n<body>\n${body}\n</body>\n</html>`;
    mount({
      page: { path: 'deck/big.html', source, busy: false },
      deck: parseDeck(source),
      previewHtml: null,
    });
    expect(screen.getByText('60/60')).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add page' });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('title', 'Reached the 60-page limit');
  });

  it('页卡「演示」按钮以该页序号上抛 onPresent', () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Present page 2' }));
    expect(h.onPresent).toHaveBeenCalledWith(1);
  });

  it('无幻灯片标记时显示空态提示', () => {
    const source = '<!doctype html><html><body><p>普通页面</p></body></html>';
    mount({
      page: { path: 'deck/empty.html', source, busy: false },
      deck: parseDeck(source),
      previewHtml: null,
    });
    expect(screen.getByText(/This page has no slide markers/)).toBeInTheDocument();
  });
});
