type BadgeTone = 'accent' | 'neutral' | 'success';

const TONE: Record<BadgeTone, string> = {
  accent: 'bg-primary/10 text-primary',
  neutral: 'bg-secondary text-muted-foreground',
  success: 'bg-success/15 text-success',
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
      className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-2xs ${TONE[tone]}`}
    >
      {online !== undefined && (
        <span
          data-testid="badge-dot"
          className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-success' : 'bg-muted-foreground/50'}`}
        />
      )}
      {label}
    </span>
  );
}
