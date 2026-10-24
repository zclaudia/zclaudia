import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { StyleSourcePanel } from '../components/StyleSourcePanel';
import type { StyleSourcePanelProps } from '../components/StyleSourcePanel';
import type { CssDeclarationRow, CssRuleRow } from '../css-source';

const declaration = (overrides: Partial<CssDeclarationRow> = {}): CssDeclarationRow => ({
  property: 'color',
  value: '#f00',
  important: false,
  winning: null,
  editable: true,
  start: 20,
  end: 30,
  valueStart: 27,
  valueEnd: 30,
  ...overrides,
});

const ruleRow = (overrides: Partial<CssRuleRow> = {}): CssRuleRow => ({
  origin: '@inline/0',
  selectorText: '.card',
  rulePath: [2],
  specificity: [0, 1, 0],
  readOnly: null,
  declarations: [],
  ...overrides,
});

function mount(overrides: Partial<StyleSourcePanelProps> = {}) {
  const props: StyleSourcePanelProps = {
    rules: { elementPath: [0], rules: [] },
    rows: [],
    busy: false,
    onApply: vi.fn(),
    truncated: false,
    ...overrides,
  };
  render(<StyleSourcePanel {...props} />);
  return { onApply: props.onApply };
}

/** 可编辑规则卡的行内便捷查询：卡片 testid 由 origin + rulePath 拼出。 */
const cardOf = (origin = '@inline/0', rulePath: number[] = [2]) =>
  screen.getByTestId(`rule-${origin}-${rulePath.join('-')}`);

describe('StyleSourcePanel（P3.5 C4：样式来源区）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('空态与截断提示', () => {
    it('rows 为空显示空态文案', () => {
      mount();
      expect(
        screen.getByText(
          'No matching stylesheet rules for this element; inline styles can be edited in the panel above.'
        )
      ).toBeInTheDocument();
      expect(screen.queryByRole('group')).not.toBeInTheDocument();
    });

    it('rules 为 null（载荷未到达）同样显示空态', () => {
      mount({ rules: null });
      expect(
        screen.getByText(
          'No matching stylesheet rules for this element; inline styles can be edited in the panel above.'
        )
      ).toBeInTheDocument();
    });

    it('truncated=true 显示截断提示', () => {
      mount({ truncated: true, rows: [ruleRow()] });
      expect(
        screen.getByText('More than 200 rules match this element; the rest are hidden.')
      ).toBeInTheDocument();
    });

    it('truncated=false 不显示截断提示', () => {
      mount({ truncated: false, rows: [ruleRow()] });
      expect(screen.queryByText(/the rest are hidden/)).not.toBeInTheDocument();
    });
  });

  describe('分组渲染与去重合并', () => {
    it('同一 (origin, rulePath) 的多条命中合并为一张规则卡，selectors 列表展示', () => {
      mount({
        rows: [
          ruleRow({ selectorText: '.card', rulePath: [2] }),
          ruleRow({ selectorText: '.featured', rulePath: [2] }),
          ruleRow({ selectorText: '.other', rulePath: [3] }),
        ],
      });
      // 同 rulePath 两行 → 一张卡、双选择器；不同 rulePath → 另一张卡。
      expect(screen.getAllByRole('group')).toHaveLength(2);
      const merged = cardOf('@inline/0', [2]);
      expect(within(merged).getByText('.card, .featured')).toBeInTheDocument();
      expect(within(cardOf('@inline/0', [3])).getByText('.other')).toBeInTheDocument();
    });

    it('按 rows 顺序渲染规则卡（预览 DOM 序透传）', () => {
      mount({
        rows: [
          ruleRow({ origin: '@inline/1', rulePath: [0, 0], selectorText: '.late' }),
          ruleRow({ origin: '@inline/0', rulePath: [2], selectorText: '.early' }),
        ],
      });
      const groups = screen.getAllByRole('group');
      expect(groups[0]).toHaveAttribute('aria-label', 'Rule .late');
      expect(groups[1]).toHaveAttribute('aria-label', 'Rule .early');
    });

    it('声明行展示属性名与源码值', () => {
      mount({ rows: [ruleRow({ declarations: [declaration({ property: 'color', value: '#ff0000' })] })] });
      const row = within(cardOf()).getByTestId('declaration-color');
      expect(row).toHaveTextContent('color:');
      expect(row).toHaveTextContent('#ff0000');
    });
  });

  describe('徽标矩阵', () => {
    it('来源徽标：@inline/n 显示 Style block #n，其他显示相对路径', () => {
      mount({
        rows: [
          ruleRow({ origin: '@inline/2' }),
          ruleRow({ origin: 'design/css/main.css', rulePath: [3] }),
        ],
      });
      expect(within(cardOf('@inline/2', [2])).getByText('Style block #2')).toBeInTheDocument();
      expect(within(cardOf('design/css/main.css', [3])).getByText('design/css/main.css')).toBeInTheDocument();
    });

    it('important 徽标：声明行带 important 时显示，否则不显示', () => {
      mount({
        rows: [
          ruleRow({ declarations: [declaration({ important: true })] }),
          ruleRow({ rulePath: [3], declarations: [declaration({ important: false })] }),
        ],
      });
      expect(within(cardOf('@inline/0', [2])).getByText('important')).toBeInTheDocument();
      expect(within(cardOf('@inline/0', [3])).queryByText('important')).not.toBeInTheDocument();
    });

    it('winning 徽标：true → Active、false → Overridden、null → 无徽标', () => {
      mount({
        rows: [
          ruleRow({
            declarations: [
              declaration({ property: 'color', winning: true }),
              declaration({ property: 'padding-top', value: '8px', winning: false }),
              declaration({ property: 'display', value: 'flex', winning: null }),
            ],
          }),
        ],
      });
      const card = cardOf();
      expect(within(card).getByTestId('winning-color')).toHaveTextContent('Active');
      expect(within(card).getByTestId('winning-padding-top')).toHaveTextContent('Overridden');
      expect(within(card).queryByTestId('winning-display')).not.toBeInTheDocument();
    });
  });

  describe('只读原因', () => {
    const readOnlyCases = [
      { reason: 'parse-error', text: 'Source parse failed' },
      {
        reason: 'align-mismatch',
        text: 'Rule could not be located in the source (browser/source mismatch)',
      },
      {
        reason: 'external-css-readonly',
        text: 'External stylesheet editing arrives in a later batch',
      },
      { reason: 'oversize', text: 'Style block is too large to edit' },
    ] as const;

    it.each(readOnlyCases)('readOnly reason=$reason → 文案「$text」且无编辑控件', ({ reason, text }) => {
      mount({ rows: [ruleRow({ readOnly: { reason }, declarations: [] })] });
      const card = cardOf();
      expect(within(card).getByText(text)).toBeInTheDocument();
      expect(within(card).queryByRole('textbox', { name: 'New property' })).not.toBeInTheDocument();
      expect(within(card).queryByRole('button', { name: /Add declaration/ })).not.toBeInTheDocument();
    });

    it('非 @inline origin 的对齐行（防御）同样不提供编辑控件', () => {
      mount({
        rows: [
          ruleRow({ origin: 'design/css/main.css', declarations: [declaration()] }),
        ],
      });
      const card = cardOf('design/css/main.css', [2]);
      expect(within(card).queryByLabelText('Value for color')).not.toBeInTheDocument();
      expect(within(card).queryByLabelText('Delete declaration color')).not.toBeInTheDocument();
      expect(within(card).queryByRole('button', { name: 'Add declaration' })).not.toBeInTheDocument();
    });
  });

  describe('编辑操作（styleBlock op 构造）', () => {
    it('改值：input + apply → { value=输入值, create:false }', () => {
      const onApply = vi.fn();
      mount({
        onApply,
        rows: [ruleRow({ declarations: [declaration({ property: 'color', value: '#f00' })] })],
      });
      const input = screen.getByRole('textbox', { name: 'Value for color' });
      expect(input).toHaveValue('#f00');
      // 值未变化时 apply 禁用（不发空事务）。
      expect(screen.getByRole('button', { name: 'Apply value for color' })).toBeDisabled();
      fireEvent.change(input, { target: { value: '#00ff00' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply value for color' }));
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onApply).toHaveBeenCalledWith([
        {
          kind: 'styleBlock',
          styleOrdinal: 0,
          rulePath: [2],
          property: 'color',
          value: '#00ff00',
          create: false,
        },
      ]);
    });

    it('删除：confirm 不需要，直接提交 value=null', () => {
      const onApply = vi.fn();
      mount({ onApply, rows: [ruleRow({ declarations: [declaration()] })] });
      fireEvent.click(screen.getByRole('button', { name: 'Delete declaration color' }));
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onApply).toHaveBeenCalledWith([
        {
          kind: 'styleBlock',
          styleOrdinal: 0,
          rulePath: [2],
          property: 'color',
          value: null,
          create: false,
        },
      ]);
    });

    it('新增：property + value 表单 → { create:true }，成功后清空输入', () => {
      const onApply = vi.fn();
      mount({ onApply, rows: [ruleRow()] });
      fireEvent.change(screen.getByRole('textbox', { name: 'New property' }), {
        target: { value: 'display' },
      });
      fireEvent.change(screen.getByRole('textbox', { name: 'New value' }), {
        target: { value: 'flex' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add declaration' }));
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onApply).toHaveBeenCalledWith([
        {
          kind: 'styleBlock',
          styleOrdinal: 0,
          rulePath: [2],
          property: 'display',
          value: 'flex',
          create: true,
        },
      ]);
      expect(screen.getByRole('textbox', { name: 'New property' })).toHaveValue('');
      expect(screen.getByRole('textbox', { name: 'New value' })).toHaveValue('');
    });

    it('新增也响应表单回车提交（form submit）', () => {
      const onApply = vi.fn();
      mount({ onApply, rows: [ruleRow()] });
      fireEvent.change(screen.getByRole('textbox', { name: 'New property' }), {
        target: { value: 'opacity' },
      });
      fireEvent.change(screen.getByRole('textbox', { name: 'New value' }), {
        target: { value: '0.5' },
      });
      fireEvent.submit(screen.getByRole('button', { name: 'Add declaration' }).closest('form')!);
      expect(onApply).toHaveBeenCalledWith([
        expect.objectContaining({ property: 'opacity', value: '0.5', create: true }),
      ]);
    });

    it('rulePath 取自命中行：@media 嵌套与多块序号透传进 op', () => {
      const onApply = vi.fn();
      mount({
        onApply,
        rows: [
          ruleRow({ origin: '@inline/1', rulePath: [0, 2], declarations: [declaration()] }),
        ],
      });
      fireEvent.click(screen.getByRole('button', { name: 'Delete declaration color' }));
      expect(onApply).toHaveBeenCalledWith([
        expect.objectContaining({ styleOrdinal: 1, rulePath: [0, 2] }),
      ]);
    });
  });

  describe('非法输入就地提示（不发事务）', () => {
    it('改值：黑名单值（url(、分号等）→ Invalid value 且 onApply 不被调', () => {
      const onApply = vi.fn();
      mount({ onApply, rows: [ruleRow({ declarations: [declaration()] })] });
      fireEvent.change(screen.getByRole('textbox', { name: 'Value for color' }), {
        target: { value: 'url(evil.png)' },
      });
      expect(screen.getByRole('button', { name: 'Apply value for color' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Apply value for color' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid value');
      expect(onApply).not.toHaveBeenCalled();
    });

    it('改值：纯空白值 → Enter a value 且不发事务', () => {
      const onApply = vi.fn();
      mount({ onApply, rows: [ruleRow({ declarations: [declaration()] })] });
      fireEvent.change(screen.getByRole('textbox', { name: 'Value for color' }), {
        target: { value: '   ' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Apply value for color' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a value');
      expect(onApply).not.toHaveBeenCalled();
    });

    it('新增：属性名违反正则/超长 → Invalid property name 且不发事务', () => {
      const onApply = vi.fn();
      mount({ onApply, rows: [ruleRow()] });
      fireEvent.change(screen.getByRole('textbox', { name: 'New property' }), {
        target: { value: '1bad prop' },
      });
      fireEvent.change(screen.getByRole('textbox', { name: 'New value' }), {
        target: { value: 'flex' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add declaration' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid property name');
      expect(onApply).not.toHaveBeenCalled();
    });

    it('新增：属性名超过 64 字符 → Invalid property name', () => {
      const onApply = vi.fn();
      mount({ onApply, rows: [ruleRow()] });
      fireEvent.change(screen.getByRole('textbox', { name: 'New property' }), {
        target: { value: 'a'.repeat(65) },
      });
      fireEvent.change(screen.getByRole('textbox', { name: 'New value' }), {
        target: { value: 'flex' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add declaration' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid property name');
      expect(onApply).not.toHaveBeenCalled();
    });

    it('修正输入后错误提示消失，合法值成功提交', () => {
      const onApply = vi.fn();
      mount({ onApply, rows: [ruleRow({ declarations: [declaration()] })] });
      const input = screen.getByRole('textbox', { name: 'Value for color' });
      fireEvent.change(input, { target: { value: 'a{b' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply value for color' }));
      expect(screen.getByRole('alert')).toBeInTheDocument();
      fireEvent.change(input, { target: { value: '#00ff00' } });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Apply value for color' }));
      expect(onApply).toHaveBeenCalledTimes(1);
    });
  });

  describe('busy 禁用', () => {
    it('busy 时输入与全部操作按钮禁用', () => {
      mount({
        busy: true,
        rows: [ruleRow({ declarations: [declaration()] })],
      });
      expect(screen.getByRole('textbox', { name: 'Value for color' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Apply value for color' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Delete declaration color' })).toBeDisabled();
      expect(screen.getByRole('textbox', { name: 'New property' })).toBeDisabled();
      expect(screen.getByRole('textbox', { name: 'New value' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Add declaration' })).toBeDisabled();
    });
  });
});
