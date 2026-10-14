import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { trapTab } from '../../utils/focusTrap';
import { Check, ChevronDown, ChevronRight, Cpu, RefreshCw } from 'lucide-react';
import type { ThinkingLevel } from '@zclaudia/shared/core/agent-profile';
import type { SessionModelSettings } from '@zclaudia/shared/core/runtime-capabilities';
import { getSessionModelSettings, saveSessionModelSettings } from '../../services/api/sessions';
import { SelectorTrigger } from './SelectorTrigger';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select, type SelectOption } from '../../components/ui/Select';
import { SECTION_LABEL } from '../../components/ui/typography';

/** The Select dropdown is portaled to <body>, so it sits outside this
 *  popover's DOM subtree. Outside-click / Escape handlers must treat an open
 *  listbox as part of the popover, or picking an option dismisses everything
 *  before the click lands. */
const isInListbox = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest('[role="listbox"]');

export function SessionModelSelector({
  sessionId,
  disabled = false,
  variant = 'default',
}: {
  sessionId: string;
  disabled?: boolean;
  /** `chip`: mobile composer card styling (no icon, larger label); tapping it
   *  opens a compact model menu whose Thinking row leads to the full dialog. */
  variant?: 'default' | 'chip';
}) {
  const [settings, setSettings] = useState<SessionModelSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'dialog'>('dialog');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [thinking, setThinking] = useState<ThinkingLevel | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const epoch = useRef(0);
  const lastSession = useRef(sessionId);
  const forceRefresh = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const id = ++epoch.current;
    if (lastSession.current !== sessionId) {
      setSettings(null);
      lastSession.current = sessionId;
    }
    setError('');
    setLoading(true);
    const discovery = open && !disabled ? (forceRefresh.current ? 'refresh' : true) : false;
    forceRefresh.current = false;
    getSessionModelSettings(sessionId, discovery, controller.signal)
      .then(value => {
        if (epoch.current !== id) return;
        setSettings(value);
        setModel(value.selection.model);
        setThinking(value.selection.thinkingLevel);
      })
      .catch(e => {
        if (!controller.signal.aborted && epoch.current === id)
          setError(e instanceof Error ? e.message : 'Could not load model settings');
      })
      .finally(() => {
        if (epoch.current === id) setLoading(false);
      });
    return () => {
      controller.abort();
      ++epoch.current;
    };
  }, [sessionId, open, refresh, disabled]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (
        !saving &&
        !ref.current?.contains(e.target as Node) &&
        !panelRef.current?.contains(e.target as Node) &&
        !isInListbox(e.target)
      )
        setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        // Let an open Select listbox consume the first Escape.
        if (document.querySelector('[role="listbox"]')) return;
        setOpen(false);
        ref.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open, saving]);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const trigger = ref.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!trigger || !panel) return;
      const margin = 12;
      const left = Math.max(
        margin,
        Math.min(trigger.left, window.innerWidth - panel.width - margin)
      );
      const above = trigger.top - panel.height - 8;
      const top =
        above >= margin
          ? above
          : Math.max(
              margin,
              Math.min(trigger.bottom + 8, window.innerHeight - panel.height - margin)
            );
      setPanelStyle({ top, left });
    };
    position();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    if (panelRef.current) observer?.observe(panelRef.current);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, view, settings, model, error, loading]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open, view]);

  const savedModel = settings?.selection.model ?? settings?.inheritedModel ?? '';
  const label = settings?.models.find(m => m.id === savedModel)?.label || savedModel || 'Model';
  const effectiveModel = model ?? (settings?.inheritedModel || settings?.defaultModel);
  const levels = settings?.models.find(m => m.id === effectiveModel)?.thinkingLevels ?? [];
  const isKnownModel = model !== null && !!settings?.models.some(m => m.id === model);
  const modelSelectValue = model === null ? '__inherit__' : isKnownModel ? model : '__custom__';
  const modelOptions: SelectOption<string>[] = !settings
    ? []
    : [
        {
          value: '__inherit__',
          label: settings.inheritedModel
            ? `Follow session default (${settings.inheritedModel})`
            : settings.defaultModel
              ? `Follow runtime (${settings.defaultModel})`
              : 'Follow runtime',
        },
        ...settings.models.map(m => ({ value: m.id, label: m.label })),
        ...(settings.allowManualModel || (model !== null && !isKnownModel)
          ? [{ value: '__custom__', label: 'Custom model ID' }]
          : []),
      ];
  const thinkingOptions: SelectOption<string>[] = !settings
    ? []
    : [
        {
          value: '',
          label: `Default${
            model === null && settings.inheritedThinkingLevel
              ? ` (${settings.inheritedThinkingLevel})`
              : ''
          }`,
        },
        ...levels.map(level => ({ value: level as string, label: level })),
        ...(thinking && !levels.includes(thinking)
          ? [{ value: thinking as string, label: `${thinking} (saved)` }]
          : []),
      ];
  const save = async (next = { model, thinkingLevel: thinking }) => {
    if (!settings) return;
    const id = epoch.current;
    setSaving(true);
    setError('');
    try {
      const value = await saveSessionModelSettings(sessionId, {
        ...next,
        revision: settings.selection.revision,
      });
      if (epoch.current === id) {
        setSettings(value);
        setOpen(false);
      }
    } catch (e) {
      if (epoch.current === id)
        setError(e instanceof Error ? e.message : 'Could not save model settings');
    } finally {
      setSaving(false);
    }
  };
  // Compact menu (chip): one tap picks a model and saves; the saved thinking
  // level carries over only when the new model offers it.
  const activeModel = settings?.selection.model ?? (savedModel || settings?.defaultModel || '');
  const menuModels =
    settings && activeModel && !settings.models.some(m => m.id === activeModel)
      ? [{ id: activeModel, label: activeModel }, ...settings.models]
      : (settings?.models ?? []);
  const thinkingLabel =
    settings?.selection.thinkingLevel ??
    (settings?.selection.model === null ? settings?.inheritedThinkingLevel : undefined) ??
    'Default';
  const pickModel = (id: string) => {
    if (!settings || saving) return;
    if (id === settings.selection.model) {
      setOpen(false);
      return;
    }
    const kept = settings.selection.thinkingLevel;
    const supported = settings.models.find(m => m.id === id)?.thinkingLevels ?? [];
    void save({ model: id, thinkingLevel: kept && supported.includes(kept) ? kept : null });
  };
  const moveMenuFocus = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ??
        []
    );
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };
  const menu = variant === 'chip' && view === 'menu';
  return (
    <div className="relative min-w-0" ref={ref}>
      <SelectorTrigger
        disabled={disabled || saving}
        onClick={() => {
          if (!open) setView(variant === 'chip' ? 'menu' : 'dialog');
          setOpen(!open);
        }}
        ariaLabel="Session model and thinking"
        ariaHasPopup={variant === 'chip' ? 'menu' : 'dialog'}
        ariaExpanded={open}
        title={label}
        variant={variant}
        active={variant === 'chip' && open}
      >
        {variant === 'default' && <Cpu size={14} />}
        <span className={`truncate ${variant === 'chip' ? 'max-w-[120px]' : 'max-w-[140px]'}`}>
          {label}
        </span>
        {settings?.selection.thinkingLevel && (
          <span className="text-muted-foreground">· {settings.selection.thinkingLevel}</span>
        )}
        <ChevronDown size={12} />
      </SelectorTrigger>
      {open &&
        menu &&
        createPortal(
          <div
            ref={panelRef}
            tabIndex={-1}
            style={panelStyle}
            onKeyDown={e => {
              moveMenuFocus(e);
              trapTab(e, panelRef.current);
            }}
            role="menu"
            aria-label="Model"
            aria-busy={loading || saving}
            className="fixed z-[110] flex w-[270px] max-w-[calc(100vw-32px)] max-h-[60vh] flex-col overflow-y-auto rounded-2xl border border-border bg-popover p-1.5 shadow-xl outline-none"
          >
            <div className={`${SECTION_LABEL} truncate px-2.5 pt-2 pb-1`}>
              {settings?.profileName || 'Models'}
            </div>
            {!settings && loading && (
              <p role="status" className="px-2.5 py-2 text-xs text-muted-foreground">
                Loading available models…
              </p>
            )}
            {menuModels.map(m => {
              const checked = m.id === activeModel;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  disabled={saving || disabled}
                  onClick={() => pickModel(m.id)}
                  className={`flex h-11 w-full flex-shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-[15px] text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                    checked ? 'bg-muted' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{m.label}</span>
                  {checked && <Check size={16} strokeWidth={2} />}
                </button>
              );
            })}
            {settings && menuModels.length === 0 && !loading && (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">
                {settings.discoveryError || 'No models available.'}
              </p>
            )}
            {error && (
              <p role="alert" className="px-2.5 py-1.5 text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="mx-1.5 my-1 h-px flex-shrink-0 bg-border" aria-hidden />
            <button
              type="button"
              role="menuitem"
              disabled={!settings || saving}
              onClick={() => setView('dialog')}
              className="flex h-11 w-full flex-shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex-1">Thinking</span>
              <span>{thinkingLabel}</span>
              <ChevronRight size={14} strokeWidth={1.75} />
            </button>
          </div>,
          document.body
        )}
      {open &&
        !menu &&
        createPortal(
          <div
            ref={panelRef}
            tabIndex={-1}
            style={panelStyle}
            onKeyDown={e => trapTab(e, panelRef.current)}
            role="dialog"
            aria-label="Session model settings"
            className="fixed z-[110] w-[300px] max-w-[calc(100vw-32px)] max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-popover p-3 shadow-xl space-y-3 outline-none"
          >
            <div className="text-sm font-medium">Model & thinking</div>
            {loading && (
              <p role="status" className="text-xs text-muted-foreground">
                Loading available models…
              </p>
            )}
            {settings && (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">Model</span>
                  <Select
                    value={modelSelectValue}
                    onChange={next => {
                      setModel(next === '__inherit__' ? null : next === '__custom__' ? '' : next);
                      setThinking(null);
                    }}
                    disabled={saving || loading || disabled}
                    block
                    size="md"
                    triggerClassName="!h-9 !text-[13px]"
                    panelPosition="fixed"
                    ariaLabel="Session model"
                    options={modelOptions}
                  />
                </div>
                {model !== null && !isKnownModel && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Model ID</span>
                    <Input
                      aria-label="Custom model ID"
                      value={model}
                      maxLength={512}
                      disabled={!settings.allowManualModel || saving || disabled}
                      onChange={e => {
                        setModel(e.target.value);
                        setThinking(null);
                      }}
                      placeholder="Enter model ID"
                      className="h-9 !px-3 !text-[13px] font-mono"
                    />
                    <span className="text-[11px] text-muted-foreground">
                      Validated by the connected runtime when the next turn starts.
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Thinking level
                  </span>
                  <Select
                    value={thinking ?? ''}
                    onChange={v => setThinking((v || null) as ThinkingLevel | null)}
                    disabled={saving || loading || disabled || levels.length === 0}
                    block
                    size="md"
                    triggerClassName="!h-9 !text-[13px]"
                    panelPosition="fixed"
                    ariaLabel="Session thinking level"
                    options={thinkingOptions}
                  />
                </div>
                {levels.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {settings.runtimeType === 'cursor'
                      ? 'Thinking follows the selected Cursor model variant.'
                      : 'This model has not advertised selectable thinking levels.'}
                  </p>
                )}
                {settings.discoveryError && (
                  <p className="text-xs text-muted-foreground">{settings.discoveryError}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Saved for this session. Applies to the next turn.
                </p>
              </>
            )}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  disabled={loading || saving || disabled}
                  onClick={() => {
                    forceRefresh.current = true;
                    setRefresh(n => n + 1);
                  }}
                >
                  <RefreshCw size={12} />
                  Refresh
                </Button>
                <Button
                  size="sm"
                  disabled={!settings || loading || saving || disabled}
                  onClick={() => {
                    setModel(null);
                    setThinking(null);
                  }}
                >
                  Use defaults
                </Button>
              </div>
              <Button
                variant="primary"
                onClick={() => void save()}
                disabled={!settings || saving || loading || disabled || model === ''}
              >
                {saving ? 'Saving…' : 'Apply'}
              </Button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
