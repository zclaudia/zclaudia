import { useEffect, useState } from 'react';
import { CircleAlert, Loader2 } from 'lucide-react';
import { Button } from '../components/ui/Button';

export function StartupConnectionState({
  message,
  error,
  onRetry,
}: {
  message: string;
  error: boolean;
  onRetry: () => void;
}) {
  const [takingLonger, setTakingLonger] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setTakingLonger(true), 10_000);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <main className="flex h-dvh flex-col bg-background text-foreground">
      <div className="safe-top-spacer shrink-0" data-tauri-drag-region />
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          {error ? (
            <CircleAlert
              className="mx-auto mb-4 h-8 w-8 text-destructive"
              strokeWidth={1.75}
              aria-hidden
            />
          ) : (
            <Loader2
              className="mx-auto mb-4 h-8 w-8 animate-spin text-muted-foreground motion-reduce:animate-none"
              strokeWidth={1.75}
              aria-hidden
            />
          )}
          <div role="status" aria-live="polite" aria-atomic="true">
            <h1 className="text-lg font-semibold">
              {error ? '连接未能建立' : takingLonger ? '连接仍在进行' : '正在准备工作区'}
            </h1>
            <p
              className={`mt-2 break-words text-sm ${error ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {message}
            </p>
            {(error || takingLonger) && (
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                请检查 Backend 是否运行、网络是否可用。应用会自动重连，你也可以重新加载后重试。
              </p>
            )}
          </div>
          {(error || takingLonger) && (
            <Button variant="outline" onClick={onRetry} className="mt-5 h-9">
              重新加载
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
