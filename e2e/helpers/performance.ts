/**
 * Performance testing utilities
 */

/**
 * Measure execution time of an async function
 */
export async function measureTime<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  console.log(`⏱ ${name}: ${duration.toFixed(2)}ms`);
  return { result, duration };
}

/**
 * Performance thresholds for common operations (in milliseconds)
 */
export const PERFORMANCE_THRESHOLDS = {
  // Session operations
  CREATE_SESSION: 3000,
  SWITCH_SESSION: 3000,
  LOAD_MESSAGE_HISTORY: 3000,

  // Import operations
  SCAN_SESSIONS: 10000,
  IMPORT_LARGE_SESSION: 30000,
  IMPORT_100_SESSIONS: 60000,

  // Rendering operations
  RENDER_LARGE_SESSION: 3000,
  RENDER_SESSION_LIST: 3000,
  SCROLL_PERFORMANCE: 2000,

  // File operations
  UPLOAD_SINGLE_FILE: 3000,
  UPLOAD_MULTIPLE_FILES: 5000,

  // UI operations
  OPEN_SETTINGS: 3000,
  SEARCH_FILTER: 2000,
  PAGINATION: 2000,

  // Page operations
  PAGE_REFRESH: 5000,
  PAGE_NAVIGATION: 3000,

  // General responsiveness
  UI_RESPONSE: 1000,
  INPUT_RESPONSE: 500,
} as const;

/**
 * Assert performance threshold
 */
export function assertPerformance(
  duration: number,
  threshold: number,
  operation: string
): void {
  if (duration > threshold) {
    console.warn(
      `⚠️ Performance warning: ${operation} took ${duration.toFixed(2)}ms (threshold: ${threshold}ms)`
    );
  } else {
    console.log(
      `✓ ${operation} within threshold: ${duration.toFixed(2)}ms / ${threshold}ms`
    );
  }
}

/**
 * Calculate statistics for multiple measurements
 */
export function calculateStats(measurements: number[]): {
  min: number;
  max: number;
  avg: number;
  median: number;
  p95: number;
  p99: number;
} {
  const sorted = [...measurements].sort((a, b) => a - b);
  const len = sorted.length;

  return {
    min: sorted[0],
    max: sorted[len - 1],
    avg: sorted.reduce((a, b) => a + b, 0) / len,
    median: sorted[Math.floor(len / 2)],
    p95: sorted[Math.floor(len * 0.95)],
    p99: sorted[Math.floor(len * 0.99)],
  };
}

/**
 * Log performance statistics
 */
export function logStats(name: string, measurements: number[]): void {
  const stats = calculateStats(measurements);
  console.log(`\n📊 ${name} Statistics:`);
  console.log(`  Min:    ${stats.min.toFixed(2)}ms`);
  console.log(`  Max:    ${stats.max.toFixed(2)}ms`);
  console.log(`  Avg:    ${stats.avg.toFixed(2)}ms`);
  console.log(`  Median: ${stats.median.toFixed(2)}ms`);
  console.log(`  P95:    ${stats.p95.toFixed(2)}ms`);
  console.log(`  P99:    ${stats.p99.toFixed(2)}ms`);
}

/**
 * Benchmark a function with multiple iterations
 */
export async function benchmark<T>(
  name: string,
  fn: () => Promise<T>,
  iterations: number = 10
): Promise<{
  results: T[];
  measurements: number[];
  stats: ReturnType<typeof calculateStats>;
}> {
  console.log(`\n🔄 Running benchmark: ${name} (${iterations} iterations)`);

  const results: T[] = [];
  const measurements: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const { result, duration } = await measureTime(`Iteration ${i + 1}`, fn);
    results.push(result);
    measurements.push(duration);
  }

  const stats = calculateStats(measurements);
  logStats(name, measurements);

  return { results, measurements, stats };
}

/**
 * Wait for condition with timeout
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return false;
}

/**
 * Memory usage tracking (browser-side)
 */
export interface MemorySnapshot {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  timestamp: number;
}

/**
 * Get memory usage snapshot (requires performance.memory API)
 */
export function getMemorySnapshot(): MemorySnapshot | null {
  if (
    typeof window !== 'undefined' &&
    'performance' in window &&
    'memory' in performance
  ) {
    const mem = (performance as any).memory;
    return {
      usedJSHeapSize: mem.usedJSHeapSize,
      totalJSHeapSize: mem.totalJSHeapSize,
      jsHeapSizeLimit: mem.jsHeapSizeLimit,
      timestamp: Date.now(),
    };
  }
  return null;
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}
