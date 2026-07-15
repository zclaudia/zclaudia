import { useToastStore, type Toast } from '../stores/toastStore';

const TYPE_STYLES: Record<Toast['type'], { bg: string; icon: string; iconColor: string }> = {
  success: { bg: 'bg-success/10 border-success/30', icon: '\u2713', iconColor: 'text-success' },
  error: {
    bg: 'bg-destructive/10 border-destructive/30',
    icon: '\u2717',
    iconColor: 'text-destructive',
  },
  info: { bg: 'bg-primary/10 border-primary/30', icon: '\u2139', iconColor: 'text-primary' },
};

function ToastCard({ toast }: { toast: Toast }) {
  const remove = useToastStore(s => s.remove);
  const style = TYPE_STYLES[toast.type];

  const body = (
    <>
      <p className="text-sm font-medium truncate">{toast.title}</p>
      {toast.message && (
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{toast.message}</p>
      )}
    </>
  );

  return (
    // Errors announce assertively; success/info politely. Each card carries its
    // own live role so it's read on insertion regardless of the container.
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 p-3 rounded-lg border shadow-lg backdrop-blur-sm
        animate-in slide-in-from-top-2 fade-in duration-200
        ${style.bg} max-w-[320px] pointer-events-auto`}
    >
      <span className={`text-sm flex-shrink-0 mt-0.5 ${style.iconColor}`} aria-hidden="true">
        {style.icon}
      </span>
      {toast.onClick ? (
        // A real button so the click-to-navigate action is keyboard-reachable.
        <button
          type="button"
          onClick={() => {
            toast.onClick?.();
            remove(toast.id);
          }}
          className="min-w-0 flex-1 text-left rounded hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {body}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{body}</div>
      )}
      <button
        type="button"
        onClick={() => remove(toast.id)}
        aria-label="Dismiss notification"
        className="text-muted-foreground hover:text-foreground text-xs flex-shrink-0 mt-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        &times;
      </button>
    </div>
  );
}

export function ToastContainer({ className }: { className?: string }) {
  const toasts = useToastStore(s => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      data-testid="toast-container"
      role="region"
      aria-label="Notifications"
      className={className ?? 'fixed bottom-4 right-4 z-50 flex flex-col gap-2'}
    >
      {toasts.map(toast => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
