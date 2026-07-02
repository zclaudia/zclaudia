export function LineageEmptyState() {
  return (
    <div className="p-4 text-xs leading-relaxed text-muted-foreground border-t border-border">
      This session hasn’t been forked yet. Use <strong className="text-foreground">Fork</strong> or{' '}
      <strong className="text-foreground">Branch</strong> on any message to split off a new branch
      from that point, and the family graph will appear here.
    </div>
  );
}
