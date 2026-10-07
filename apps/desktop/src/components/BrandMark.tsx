import { BRAND_SHAPES } from './brand-shapes.generated';

interface BrandMarkProps {
  className?: string;
  variant?: 'color' | 'monochrome';
}

export function BrandMark({ className = '', variant = 'color' }: BrandMarkProps) {
  const monochrome = variant === 'monochrome';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={monochrome ? '32 82 448 360' : '0 0 512 512'}
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {monochrome ? (
        <path d={BRAND_SHAPES.monochromePath} fill="currentColor" fillRule="evenodd" />
      ) : (
        <>
          <path {...BRAND_SHAPES.head} />
          <path {...BRAND_SHAPES.faceMask} />
          {BRAND_SHAPES.eyes.map((eye, index) => (
            <rect key={index} {...eye} />
          ))}
        </>
      )}
    </svg>
  );
}
