import { ArrowLeft } from 'lucide-react';
import { Badge } from './Badge';
import type { DetailBadge } from './DetailHeader';
import { SaveStateIndicator } from './SaveStateIndicator';
import type { SaveStatus } from '../useProfileAutosave';

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
}

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
}: ProfileHeaderProps) {
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex flex-shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> {crumb}
        </button>
        <span className="flex-shrink-0 text-sm text-muted-foreground/50">/</span>
        <input
          type="text"
          value={name}
          onChange={e => onNameChange(e.target.value)}
          onBlur={onFieldBlur}
          placeholder={namePlaceholder}
          aria-label="Profile name"
          size={1}
          disabled={disabled}
          className="w-auto min-w-[3rem] max-w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-foreground [field-sizing:content] hover:border-border focus:border-border focus:bg-background/60 focus:outline-none disabled:cursor-default disabled:opacity-70"
        />
        {(badges.length > 0 || saveStatus) && (
          <div className="ml-auto flex flex-shrink-0 items-center gap-2 pl-2">
            {badges.map(b => (
              <Badge key={b.label} label={b.label} tone={b.tone} online={b.online} />
            ))}
            {saveStatus && <SaveStateIndicator status={saveStatus} onRetry={onRetry} />}
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
