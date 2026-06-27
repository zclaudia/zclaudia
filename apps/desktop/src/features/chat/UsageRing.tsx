interface UsageRingProps {
  /** Fraction filled, clamped to [0,1]. */
  ratio: number;
  /** Color class on the svg; the arc inherits it through `currentColor`. */
  className?: string;
  /** Accessible label, e.g. "Context window 33% used". */
  label?: string;
  /** Rendered pixel size of the square svg. Default 16. */
  size?: number;
}

const R = 7;
const C = 2 * Math.PI * R; // ≈ 43.98

/**
 * A small donut gauge: a neutral track ring plus a foreground arc whose sweep
 * encodes `ratio`. The arc uses `currentColor`, so callers set the threshold
 * color via `className` (e.g. `text-destructive`). Purely presentational.
 */
export function UsageRing({ ratio, className, label, size = 16 }: UsageRingProps) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const dim = R * 2 + 4; // 18 — leaves room for the 2.5 stroke
  const center = dim / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${dim} ${dim}`}
      className={className}
      role="img"
      aria-label={label}
    >
      <circle cx={center} cy={center} r={R} fill="none" strokeWidth={2.5} className="stroke-border" />
      <circle
        cx={center}
        cy={center}
        r={R}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - clamped)}
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  );
}
