import { ArrowLeft } from 'lucide-react';
import { Badge } from './Badge';
import type { DetailBadge } from './DetailHeader';
import { SaveStateIndicator } from './SaveStateIndicator';
import type { SaveStatus } from '../useProfileAutosave';
import { StatusChip } from '../../../components/ui/StatusChip';
import type { RecordStatus } from '@zclaudia/shared/core/record-status';
import { ActionsMenu } from './ActionsMenu';
import type { ActionsMenuAction } from './ActionsMenu';

export interface ProfileHeaderProps {
  crumb: string;
  onBack: () => void;
  name: string;
  onNameChange: (v: string) => void;
  onFieldBlur?: () => void;
  namePlaceholder: string;
  /** Optional — omit (along with onDescriptionChange) for records without a
   *  description field, e.g. LLM profiles. The description input is only
   *  rendered when onDescriptionChange is provided. */
  description?: string;
  onDescriptionChange?: (v: string) => void;
  badges?: DetailBadge[];
  saveStatus?: SaveStatus;
  onRetry?: () => void;
  /** When true, name/description inputs are disabled (read-only profile). */
  disabled?: boolean;
  recordStatus?: RecordStatus;
  /** "⋯" menu rendered at the far right of the header (e.g. delete/set-default). */
  actions?: ActionsMenuAction[];
}

/** Context that only earns a slot where the row has width to spare. */
const HIDE_ON_MOBILE = 'hidden md:inline-flex';

export function ProfileHeader({
  crumb,
  onBack,
  name,
  onNameChange,
  onFieldBlur,
  namePlaceholder,
  description = '',
  onDescriptionChange,
  badges = [],
  saveStatus,
  onRetry,
  disabled,
  recordStatus,
  actions,
}: ProfileHeaderProps) {
  const hasStatusCluster = badges.length > 0 || !!saveStatus || !!recordStatus;
  // What survives to a phone: signals, never context. If none of them apply the
  // cluster is dropped entirely there, leaving a single-line header.
  const hasMobileSignal =
    badges.some(b => !b.secondary) || !!recordStatus || (!!saveStatus && saveStatus !== 'saved');

  return (
    <div className="border-b border-border px-4 py-3">
      {/* Wraps at narrow widths: the badge/actions cluster drops to a second
          line instead of being pushed past the viewport edge (the actions menu
          used to end up clipped and unreachable on phones). */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={onBack}
          aria-label={`Back to ${crumb}`}
          className="inline-flex flex-shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          {/* The crumb label repeats the app header's own title on a phone and
              costs a quarter of the row; the arrow alone carries it there. */}
          <span className="hidden md:inline">{crumb}</span>
        </button>
        <span className="hidden flex-shrink-0 text-sm text-muted-foreground/50 md:inline">/</span>
        <input
          type="text"
          value={name}
          onChange={e => onNameChange(e.target.value)}
          onBlur={onFieldBlur}
          placeholder={namePlaceholder}
          aria-label="Profile name"
          size={1}
          disabled={disabled}
          className="min-w-0 max-w-full flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-foreground [field-sizing:content] hover:border-border focus:border-border focus:bg-background/60 focus:outline-none disabled:cursor-default disabled:opacity-70 md:w-auto md:min-w-[3rem] md:flex-none"
        />
        {/* The badge cluster must stay shrinkable: `flex-shrink-0` here would size
            it to its max-content width, so its own `flex-wrap` would never trigger
            and trailing badges (plus the actions menu) would be clipped off-screen
            at phone widths instead of wrapping.

            Below md it also takes a line of its own (`basis-full order-last`)
            rather than sharing one with the name — a status chip next to the
            name input clipped the name mid-word, and an input cannot ellipsize. */}
        {hasStatusCluster && (
          <div
            className={`order-last ml-0 flex min-w-0 basis-full flex-wrap items-center justify-start gap-2 md:order-none md:ml-auto md:basis-auto md:justify-end md:pl-2 ${
              hasMobileSignal ? 'flex' : 'hidden md:flex'
            }`}
          >
            {badges.map(b =>
              b.secondary ? (
                <span key={b.label} className={HIDE_ON_MOBILE}>
                  <Badge label={b.label} tone={b.tone} online={b.online} />
                </span>
              ) : (
                <Badge key={b.label} label={b.label} tone={b.tone} online={b.online} />
              )
            )}
            {recordStatus && <StatusChip status={recordStatus} />}
            {saveStatus &&
              (saveStatus === 'saved' ? (
                // A settled autosave is not news. It keeps its desktop slot,
                // where the row has width to spare, but on a phone it only
                // appears while saving, blocked, or failed.
                <span className={HIDE_ON_MOBILE}>
                  <SaveStateIndicator status={saveStatus} onRetry={onRetry} />
                </span>
              ) : (
                <SaveStateIndicator status={saveStatus} onRetry={onRetry} />
              ))}
          </div>
        )}
        {actions && actions.length > 0 && (
          <div className="ml-auto flex flex-shrink-0 items-center md:ml-0">
            <ActionsMenu actions={actions} />
          </div>
        )}
      </div>
      {onDescriptionChange && (
        <input
          type="text"
          value={description}
          onChange={e => onDescriptionChange(e.target.value)}
          onBlur={onFieldBlur}
          placeholder="Add a description"
          aria-label="Profile description"
          size={1}
          disabled={disabled}
          className="mt-1 block w-auto min-w-[3rem] max-w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted-foreground [field-sizing:content] hover:border-border focus:border-border focus:bg-background/60 focus:outline-none disabled:cursor-default disabled:opacity-70"
        />
      )}
    </div>
  );
}
