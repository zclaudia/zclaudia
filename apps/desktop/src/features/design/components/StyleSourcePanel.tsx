import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import type { CssDeclarationRow, CssRuleRow } from '../css-source';
import { safeSourceCssValue } from '../html/values';
import {
  STYLE_RULES_MAX,
  STYLE_SOURCE_PROPERTY_MAX,
  STYLE_SOURCE_PROPERTY_PATTERN,
} from '../types';
import type { DesignEditOperation, DesignRulesMessage } from '../types';

const EMPTY_NOTICE =
  'No matching stylesheet rules for this element; inline styles can be edited in the panel above.';
const TRUNCATED_NOTICE = `More than ${STYLE_RULES_MAX} rules match this element; the rest are hidden.`;
const INVALID_PROPERTY_NOTICE = 'Invalid property name';
const INVALID_VALUE_NOTICE = 'Invalid value';
const REQUIRED_VALUE_NOTICE = 'Enter a value';

/** 只读原因文案（§5 四类明示，绝不猜测定位）。 */
const READ_ONLY_NOTICES: Record<NonNullable<CssRuleRow['readOnly']>['reason'], string> = {
  'parse-error': 'Source parse failed',
  'align-mismatch': 'Rule could not be located in the source (browser/source mismatch)',
  'external-css-readonly': 'External stylesheet editing arrives in a later batch',
  oversize: 'Style block is too large to edit',
};

/** 预览来源标记的入口自有 `<style>` 块前缀（preview.ts 打标口径）。 */
const INLINE_ORIGIN_PREFIX = '@inline/';

/** origin → 入口样式块序号；非 `@inline` 来源（外部 .css）第一批只读，返回 null。 */
function styleOrdinalOf(origin: string): number | null {
  if (!origin.startsWith(INLINE_ORIGIN_PREFIX)) return null;
  const ordinal = Number(origin.slice(INLINE_ORIGIN_PREFIX.length));
  return Number.isInteger(ordinal) && ordinal >= 0 ? ordinal : null;
}

/** 来源徽标文案：`@inline/n` → Style block #n；其余显示工作区相对路径原值。 */
function originLabel(origin: string): string {
  const ordinal = styleOrdinalOf(origin);
  return ordinal === null ? origin : `Style block #${ordinal}`;
}

/** 渲染层的规则卡模型：同一 (origin, rulePath) 的多条命中合并为一张卡。 */
interface RuleCardModel {
  key: string;
  origin: string;
  rulePath: number[];
  /** 选择器组多命中去重后的选择器列表（保序）。 */
  selectors: string[];
  readOnly: CssRuleRow['readOnly'];
  /** 取组内首行的声明（对齐结果只取决于 origin+rulePath，组内一致）。 */
  declarations: CssDeclarationRow[];
}

/** 渲染层去重合并（§5）：选择器组多命中（C1 口径）共用一张规则卡，编辑操作取任一。 */
function groupRows(rows: CssRuleRow[]): RuleCardModel[] {
  const cards: RuleCardModel[] = [];
  const byKey = new Map<string, RuleCardModel>();
  for (const row of rows) {
    const key = `${row.origin}\u0000${row.rulePath.join('.')}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.selectors.includes(row.selectorText)) existing.selectors.push(row.selectorText);
      continue;
    }
    const card: RuleCardModel = {
      key,
      origin: row.origin,
      rulePath: row.rulePath,
      selectors: [row.selectorText],
      readOnly: row.readOnly,
      declarations: row.declarations,
    };
    byKey.set(key, card);
    cards.push(card);
  }
  return cards;
}

const BADGE_CLASS = 'rounded bg-muted px-1 text-[9px] font-medium text-muted-foreground';

/** 属性名/值预检（§4：非法就地提示，不发事务）。返回错误文案或 null。 */
function validateSourceInput(property: string, value: string): string | null {
  if (
    !property ||
    property.length > STYLE_SOURCE_PROPERTY_MAX ||
    !STYLE_SOURCE_PROPERTY_PATTERN.test(property)
  ) {
    return INVALID_PROPERTY_NOTICE;
  }
  if (!value.trim()) return REQUIRED_VALUE_NOTICE;
  if (safeSourceCssValue(value) === null) return INVALID_VALUE_NOTICE;
  return null;
}

interface DeclarationRowProps {
  declaration: CssDeclarationRow;
  /** 入口 `<style>` 块序号（null = 非 @inline 来源，不提供编辑控件）。 */
  ordinal: number | null;
  rulePath: number[];
  busy: boolean;
  onApply: (operations: DesignEditOperation[]) => void;
}

/** 单条声明行：属性名、源码值与生效徽标；可编辑时提供改值（input + apply）与删除（走撤销）。 */
function DeclarationRow({ declaration, ordinal, rulePath, busy, onApply }: DeclarationRowProps) {
  const [draft, setDraft] = useState(declaration.value);
  const [error, setError] = useState<string | null>(null);
  const editable = declaration.editable && ordinal !== null;

  const submitValue = () => {
    if (ordinal === null) return;
    const invalid = validateSourceInput(declaration.property, draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    onApply([
      {
        kind: 'styleBlock',
        styleOrdinal: ordinal,
        rulePath,
        property: declaration.property,
        value: draft,
        create: false,
      },
    ]);
  };

  const remove = () => {
    if (ordinal === null) return;
    setError(null);
    onApply([
      {
        kind: 'styleBlock',
        styleOrdinal: ordinal,
        rulePath,
        property: declaration.property,
        value: null,
        create: false,
      },
    ]);
  };

  return (
    <div className="grid gap-1" data-testid={`declaration-${declaration.property}`}>
      <div className="flex items-center gap-1 font-mono text-[11px]">
        <span className="font-medium text-foreground">{declaration.property}:</span>
        <span className="truncate text-muted-foreground" title={declaration.value}>
          {declaration.value}
        </span>
        {declaration.winning === true && (
          <span data-testid={`winning-${declaration.property}`} className={BADGE_CLASS}>
            Active
          </span>
        )}
        {declaration.winning === false && (
          <span data-testid={`winning-${declaration.property}`} className={BADGE_CLASS}>
            Overridden
          </span>
        )}
      </div>
      {editable && (
        <div className="flex items-center gap-1">
          <Input
            aria-label={`Value for ${declaration.property}`}
            value={draft}
            disabled={busy}
            aria-invalid={error !== null || undefined}
            onChange={event => {
              setDraft(event.target.value);
              setError(null);
            }}
          />
          <Button
            size="sm"
            className="shrink-0"
            disabled={busy || draft === declaration.value}
            aria-label={`Apply value for ${declaration.property}`}
            onClick={submitValue}
          >
            Apply
          </Button>
          <Button
            size="sm"
            className="shrink-0"
            disabled={busy}
            aria-label={`Delete declaration ${declaration.property}`}
            onClick={remove}
          >
            Delete
          </Button>
        </div>
      )}
      {error !== null && (
        <div role="alert" className="text-[11px] text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}

interface AddDeclarationFormProps {
  ordinal: number;
  rulePath: number[];
  busy: boolean;
  onApply: (operations: DesignEditOperation[]) => void;
}

/** 新增声明表单（§4：create=true，属性不存在才生效；非法就地提示，不发事务）。 */
function AddDeclarationForm({ ordinal, rulePath, busy, onApply }: AddDeclarationFormProps) {
  const [property, setProperty] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const name = property.trim();
    const invalid = validateSourceInput(name, value);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setProperty('');
    setValue('');
    onApply([
      { kind: 'styleBlock', styleOrdinal: ordinal, rulePath, property: name, value, create: true },
    ]);
  };

  return (
    <div className="grid gap-1">
      <form
        className="flex items-center gap-1"
        onSubmit={event => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          aria-label="New property"
          placeholder="property"
          value={property}
          disabled={busy}
          className="font-mono"
          aria-invalid={error === INVALID_PROPERTY_NOTICE || undefined}
          onChange={event => {
            setProperty(event.target.value);
            setError(null);
          }}
        />
        <Input
          aria-label="New value"
          placeholder="value"
          value={value}
          disabled={busy}
          aria-invalid={
            (error === INVALID_VALUE_NOTICE || error === REQUIRED_VALUE_NOTICE) || undefined
          }
          onChange={event => {
            setValue(event.target.value);
            setError(null);
          }}
        />
        <Button size="sm" className="shrink-0" type="submit" disabled={busy} aria-label="Add declaration">
          Add
        </Button>
      </form>
      {error !== null && (
        <div role="alert" className="text-[11px] text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}

interface RuleCardProps {
  card: RuleCardModel;
  busy: boolean;
  onApply: (operations: DesignEditOperation[]) => void;
}

/** 单张规则卡：选择器（等宽）、来源/important 徽标、只读原因或声明行 + 新增表单。 */
function RuleCard({ card, busy, onApply }: RuleCardProps) {
  const ordinal = styleOrdinalOf(card.origin);
  const editable = card.readOnly === null && ordinal !== null;
  const important = card.declarations.some(declaration => declaration.important);
  return (
    <div
      role="group"
      aria-label={`Rule ${card.selectors.join(', ')}`}
      data-testid={`rule-${card.origin}-${card.rulePath.join('-')}`}
      className="rounded-md border border-border p-2"
    >
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-mono text-xs text-foreground">{card.selectors.join(', ')}</span>
        <span className={BADGE_CLASS}>{originLabel(card.origin)}</span>
        {important && <span className={BADGE_CLASS}>important</span>}
      </div>
      {card.readOnly !== null ? (
        <div className="mt-1 text-[11px] text-muted-foreground">
          {READ_ONLY_NOTICES[card.readOnly.reason]}
        </div>
      ) : (
        <>
          {card.declarations.length > 0 && (
            <div className="mt-1 flex flex-col gap-1.5">
              {card.declarations.map(declaration => (
                <DeclarationRow
                  // key 含值与偏移：应用后 rules 刷新重建行对象时输入随 key 重挂载复位。
                  key={`${declaration.start}:${declaration.property}:${declaration.value}`}
                  declaration={declaration}
                  ordinal={ordinal}
                  rulePath={card.rulePath}
                  busy={busy}
                  onApply={onApply}
                />
              ))}
            </div>
          )}
          {editable && ordinal !== null && (
            <div className="mt-2 border-t border-border pt-2">
              <AddDeclarationForm
                ordinal={ordinal}
                rulePath={card.rulePath}
                busy={busy}
                onApply={onApply}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export interface StyleSourcePanelProps {
  /** 校验通过的 design-rules 载荷（null = 尚未到达或无选区）；参与空态判定。 */
  rules: DesignRulesMessage | null;
  /** css-source.buildStyleRules 对当前选区 + 活动页草稿的对齐结果。 */
  rows: CssRuleRow[];
  busy: boolean;
  onApply: (operations: DesignEditOperation[]) => void;
  /** 桥内规则数超上限（payload truncated），列表不完整时提示。 */
  truncated: boolean;
}

/**
 * 样式来源区（P3.5 §5）：按预览 DOM 序展示选中元素命中的样式表规则，
 * 声明级编辑（改值/删除/新增）经 onApply 提交 styleBlock 事务；只读规则
 * 明示原因。组件为纯展示：对齐与校验分别由 css-source/values 完成。
 */
export function StyleSourcePanel({ rules, rows, busy, onApply, truncated }: StyleSourcePanelProps) {
  const cards = useMemo(() => groupRows(rows), [rows]);
  return (
    <section className="flex flex-col gap-2" aria-label="Style sources">
      <div className="text-[11px] font-medium text-muted-foreground">Style sources</div>
      {(rules === null || rows.length === 0) && (
        <p className="text-xs text-muted-foreground">{EMPTY_NOTICE}</p>
      )}
      {truncated && (
        <div role="status" className="text-[11px] text-muted-foreground">
          {TRUNCATED_NOTICE}
        </div>
      )}
      {cards.map(card => (
        <RuleCard key={card.key} card={card} busy={busy} onApply={onApply} />
      ))}
    </section>
  );
}
