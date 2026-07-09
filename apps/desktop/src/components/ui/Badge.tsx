type BadgeTone = 'accent' | 'neutral' | 'success';

const TONE: Record<BadgeTone, string> = {
  accent: 'bg-primary/10 text-primary',
  neutral: 'bg-secondary text-muted-foreground border border-border/60',
  success: 'bg-secondary text-muted-foreground border border-border/60',
};

export function Badge({
  label,
  tone = 'neutral',
  online,
}: {
  label: string;
  tone?: BadgeTone;
  online?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${TONE[tone]}`}
    >
      {online !== undefined && (
        <span
          data-testid="badge-dot"
          className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`}
        />
      )}
      {label}
    </span>
  );
}
