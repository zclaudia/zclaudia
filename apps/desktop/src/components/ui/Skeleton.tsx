export function PaneSkeleton() {
  return (
    <div className="w-full space-y-3 p-6" aria-hidden="true">
      <div data-skeleton className="h-7 w-40 animate-pulse rounded-md bg-muted" />
      <div data-skeleton className="h-24 w-full animate-pulse rounded-md bg-muted" />
      <div data-skeleton className="h-24 w-full animate-pulse rounded-md bg-muted" />
    </div>
  );
}
