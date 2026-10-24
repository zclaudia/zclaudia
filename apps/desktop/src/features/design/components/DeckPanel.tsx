import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { FIELD_CLASS, Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/Select';
import {
  addDeckSlide,
  deleteDeckSlide,
  filterSlideInPreviewHtml,
  parseDeck,
  reorderDeckSlides,
  setDeckRatio,
  updateDeckSlideNotes,
  updateDeckSlideTitle,
  type DeckInfo,
  type DeckRatio,
  type DeckSlide,
} from '../deck';

/** 幻灯片数量上限（与 deck.ts 纯函数校验一致；此处仅用于界面禁用与提示）。 */
const MAX_SLIDES = 60;
const MAX_NOTES_LENGTH = 2000;

/** 缩略图尺寸（对齐 PageOverview：360×240 布局缩放到显示宽 160）。 */
const FRAME_W = 360;
const FRAME_H = 240;
const DISPLAY_W = 160;
const THUMB_SCALE = DISPLAY_W / FRAME_W;
const DISPLAY_H = Math.round(FRAME_H * THUMB_SCALE);

const SIBLINGS_HINT = 'Slides are not under the same parent and cannot be reordered';
const FIRST_HINT = 'Already the first page';
const LAST_HINT = 'Already the last page';
const LIMIT_HINT = 'Reached the 60-page limit';
const COMMIT_FAILED = 'The change did not take effect: the page is busy or the content did not change.';

export interface DeckPanelProps {
  open: boolean;
  /** 活动页信息；null = 关闭态。 */
  page: { path: string; source: string; busy: boolean } | null;
  /** 已构建的活动页静态预览 HTML（复用面板缓存）；null = 构建中。 */
  previewHtml: string | null;
  /** deck 结构（面板按 draftRevision memo 的 parseDeck 结果）。 */
  deck: DeckInfo | null;
  /** 提交源码变换（面板接 controller.applySource）；false = 未生效。 */
  onCommit: (source: string, label: string) => Promise<boolean>;
  onPresent: (startIndex: number) => void;
  onClose: () => void;
}

/**
 * 幻灯片面板（P5 §5.1）：页卡网格（mini iframe 缩略图 + 标题/排序/删除/
 * 演示/备注）+ 底部工具条（新增页、比例、N/60）。全部结构操作先调 deck.ts
 * 纯函数得到新 source，乐观重建本地视图后经 onCommit 提交；纯函数抛错或
 * onCommit 返回 false 时以页内 alert 显示。busy 时全部操作禁用。
 */
export function DeckPanel({
  open,
  page,
  previewHtml,
  deck,
  onCommit,
  onPresent,
  onClose,
}: DeckPanelProps) {
  const pagePath = page?.path ?? '';
  const pageSource = page?.source ?? '';
  const [source, setSource] = useState(pageSource);
  const [alert, setAlert] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  // props 页面 source 由面板 state 驱动刷新：父级落定（或拒绝）后同步本地基线。
  useEffect(() => {
    setSource(pageSource);
  }, [pagePath, pageSource]);

  // 本地 source 为准（含乐观更新）；解析失败回退父级 memo 的 deck 结构。
  const info = useMemo<DeckInfo | null>(() => {
    try {
      return parseDeck(source);
    } catch {
      return deck;
    }
  }, [source, deck]);

  if (!open || !page) return null;

  const busy = page.busy;
  const slides = info?.slides ?? [];
  const ratio: DeckRatio = info?.ratio ?? '16:9';
  const siblings = info?.siblings ?? false;

  /** 纯函数变换 → 乐观更新 → 提交；抛错/拒绝均以页内 alert 显示。 */
  const run = async (transform: (base: string) => string, label: string) => {
    if (!page || page.busy) return;
    const base = source;
    setAlert('');
    let next: string;
    try {
      next = transform(base);
    } catch (error) {
      setAlert(error instanceof Error ? error.message : String(error));
      return;
    }
    setSource(next);
    const ok = await onCommit(next, label);
    if (!ok) {
      setAlert(COMMIT_FAILED);
      setSource(page.source);
    }
  };

  const toggleNotes = (slide: DeckSlide) => {
    setExpanded(current => (current === slide.index ? null : slide.index));
    setNotesDraft(slide.notes);
  };

  const renderCard = (slide: DeckSlide) => {
    const n = slide.index + 1;
    const upDisabled = busy || !siblings || slide.index === 0;
    const downDisabled = busy || !siblings || slide.index === slides.length - 1;
    const upTitle = !siblings ? SIBLINGS_HINT : slide.index === 0 ? FIRST_HINT : `Move page ${n} up`;
    const downTitle =
      !siblings ? SIBLINGS_HINT : slide.index === slides.length - 1 ? LAST_HINT : `Move page ${n} down`;
    let thumb: string | null = null;
    if (previewHtml) {
      try {
        thumb = filterSlideInPreviewHtml(previewHtml, slide.index);
      } catch {
        thumb = null;
      }
    }
    return (
      <li key={slide.index} className="flex flex-col gap-1 rounded-md border border-border p-1.5">
        <div
          className="overflow-hidden rounded border border-border bg-white"
          style={{ width: DISPLAY_W, height: DISPLAY_H }}
        >
          {thumb ? (
            <iframe
              title={`Thumbnail of page ${n}`}
              sandbox="allow-scripts"
              srcDoc={thumb}
              aria-hidden
              style={{
                width: FRAME_W,
                height: FRAME_H,
                transform: `scale(${THUMB_SCALE})`,
                transformOrigin: 'top left',
                border: '0',
                pointerEvents: 'none',
              }}
            />
          ) : (
            <div
              data-testid={`deck-thumb-placeholder-${slide.index}`}
              className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground"
            >
              Building preview…
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground">{n}</span>
          <Input
            aria-label={`Title of page ${n}`}
            value={slide.title}
            disabled={busy}
            onChange={event =>
              void run(
                base => updateDeckSlideTitle(base, slide.index, event.target.value),
                `Edit title of page ${n}`
              )
            }
            className="h-6 flex-1 px-1.5 py-0 text-[11px]"
          />
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            aria-label={`Move page ${n} up`}
            title={upTitle}
            disabled={upDisabled}
            onClick={() =>
              void run(base => reorderDeckSlides(base, slide.index, slide.index - 1), `Move page ${n} up`)
            }
          >
            Move up
          </Button>
          <Button
            size="sm"
            aria-label={`Move page ${n} down`}
            title={downTitle}
            disabled={downDisabled}
            onClick={() =>
              void run(base => reorderDeckSlides(base, slide.index, slide.index + 1), `Move page ${n} down`)
            }
          >
            Move down
          </Button>
          <Button
            size="sm"
            aria-label={`Delete page ${n}`}
            title={`Delete page ${n}`}
            disabled={busy}
            onClick={() => setPendingDelete(slide.index)}
          >
            Delete
          </Button>
          <Button
            size="sm"
            aria-label={`Present page ${n}`}
            title={`Present from page ${n}`}
            disabled={busy}
            onClick={() => onPresent(slide.index)}
          >
            Present
          </Button>
          <Button
            size="sm"
            aria-label={`Notes of page ${n}`}
            title="Speaker notes"
            disabled={busy}
            onClick={() => toggleNotes(slide)}
          >
            {expanded === slide.index ? 'Collapse' : 'Notes'}
          </Button>
        </div>
        {expanded === slide.index && (
          <div className="flex flex-col gap-1">
            <textarea
              aria-label={`Notes content of page ${n}`}
              value={notesDraft}
              rows={3}
              disabled={busy}
              onChange={event => setNotesDraft(event.target.value)}
              className={`${FIELD_CLASS} resize-y text-xs`}
            />
            <div className="flex items-center justify-between gap-1">
              <span
                className={`text-[10px] ${
                  notesDraft.length > MAX_NOTES_LENGTH ? 'text-destructive' : 'text-muted-foreground'
                }`}
              >
                {`${notesDraft.length}/${MAX_NOTES_LENGTH}`}
              </span>
              <Button
                size="sm"
                variant="primary"
                aria-label={`Save notes of page ${n}`}
                disabled={busy || notesDraft.length > MAX_NOTES_LENGTH}
                onClick={() =>
                  void run(
                    base => updateDeckSlideNotes(base, slide.index, notesDraft),
                    `Edit notes of page ${n}`
                  )
                }
              >
                Save
              </Button>
            </div>
          </div>
        )}
      </li>
    );
  };

  const renderDeleteConfirm = (index: number) => {
    const n = index + 1;
    return (
      <Modal
        open
        onClose={() => setPendingDelete(null)}
        ariaLabel="Delete slide"
        title="Delete slide"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              aria-label={`Confirm deleting page ${n}`}
              onClick={() => {
                setPendingDelete(null);
                void run(base => deleteDeckSlide(base, index), `Delete page ${n}`);
              }}
            >
              Confirm delete
            </Button>
          </div>
        }
      >
        <div className="p-4 text-xs text-muted-foreground">
          Delete page {n}? It can be restored via undo.
        </div>
      </Modal>
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="Slides"
      title="Slides"
      size="2xl"
      footer={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            aria-label="Add page"
            title={slides.length >= MAX_SLIDES ? LIMIT_HINT : 'Append a page at the end'}
            disabled={busy || slides.length >= MAX_SLIDES}
            onClick={() => void run(base => addDeckSlide(base).source, 'Add slide')}
          >
            Add page
          </Button>
          <Select
            value={ratio}
            onChange={next =>
              void run(base => setDeckRatio(base, next), `Set slide aspect ratio to ${next}`)
            }
            options={[
              { value: '16:9', label: '16:9' },
              { value: '4:3', label: '4:3' },
            ]}
            ariaLabel="Slide aspect ratio"
            title="Slide aspect ratio"
            disabled={busy}
            size="sm"
            className="w-24 shrink-0"
          />
          <span className="ml-auto text-[11px] text-muted-foreground">
            {`${slides.length}/${MAX_SLIDES}`}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-2 p-4 text-xs">
        {alert && (
          <div role="alert" className="text-destructive">
            {alert}
          </div>
        )}
        {slides.length === 0 ? (
          <p className="text-muted-foreground">This page has no slide markers; "Add page" will write the first slide.</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2">
            {slides.map(renderCard)}
          </ul>
        )}
      </div>
      {pendingDelete !== null && renderDeleteConfirm(pendingDelete)}
    </Modal>
  );
}
