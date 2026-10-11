import type { ReactNode } from 'react';

interface ComposerFooterProps {
  left: ReactNode;
  right?: ReactNode;
}

/** One-line composer footer: metadata chips on the left, usage on the right. */
export function ComposerFooter({ left, right }: ComposerFooterProps) {
  return (
    <div
      data-testid="composer-footer"
      className="zc-composer-footer mt-2 hidden items-center gap-1.5 px-1 text-[11px] leading-none md:flex"
    >
      <div className="zc-composer-selectors flex min-w-0 items-center gap-1.5">{left}</div>
      <span className="zc-composer-spacer flex-1 min-w-[8px]" />
      {right && <div className="zc-composer-usage flex flex-shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}
