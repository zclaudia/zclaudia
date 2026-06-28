import { Loader2, Zap } from 'lucide-react';

export function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 size={20} className="animate-spin text-muted-foreground" />
    </div>
  );
}

export function EmptyState({ message, subtitle }: { message: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Zap size={24} className="mb-2 opacity-40" />
      <p className="text-sm">{message}</p>
      {subtitle && <p className="text-xs mt-1 opacity-60">{subtitle}</p>}
    </div>
  );
}
