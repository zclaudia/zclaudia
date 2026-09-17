export function CapabilityNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/55 p-3">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
