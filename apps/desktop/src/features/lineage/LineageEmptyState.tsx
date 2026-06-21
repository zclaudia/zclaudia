export function LineageEmptyState() {
  return (
    <div className="p-4 text-xs leading-relaxed text-muted-foreground border-t border-border">
      此会话还没有分叉。点消息上的 <strong className="text-foreground">Fork</strong> 或{' '}
      <strong className="text-foreground">Branch</strong> 可以从任意一点劈出新分支,之后就会在这里出现家族图。
    </div>
  );
}
