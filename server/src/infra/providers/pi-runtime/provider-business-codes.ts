/**
 * Provider business error code classification for retry decisions.
 *
 * Adapted from ZCode (Apache-2.0, Copyright 2026 Z.AI Co., Ltd.),
 * apps/zcode-cli/packages/adapters/src/model/failure-provider-business-codes.ts.
 * BigModel/Z.AI-compatible providers may deliver these codes inside HTTP 200
 * SSE error frames — either as structured `code` fields or as
 * `[1302][…][request_id]` message prefixes (see ZCode
 * docs/bigmodel-business-error-retry.md). Pure functions only.
 */

/** Retry verdict for a single provider business code. */
export interface BusinessCodeInfo {
  /** True when the failure is transient and a retry can succeed. */
  retryable: boolean;
  /** Coarse failure category, using ZCode's failure-reason vocabulary. */
  reason: string;
}

/** A business code parsed out of an error message, together with its verdict. */
export interface ClassifiedBusinessError {
  code: string;
  info: BusinessCodeInfo;
}

// 业务码 → {retryable, reason} 分类表。表数据参考 ZCode
// apps/zcode-cli/packages/adapters/src/model/failure-provider-business-codes.ts
// 与 docs/bigmodel-business-error-retry.md（BigModel API 错误码 FAQ 语义）：
// 瞬时并发/负载/网络类可重试；日/周/月限额、套餐权限、公平使用限制类终止——
// 自动重试无法改变结果，还可能放大 provider 侧限流。
const BUSINESS_CODES = new Map<string, BusinessCodeInfo>([
  // —— 可重试：BigModel 文档标注可恢复的瞬时错误 ——
  ['1120', { retryable: true, reason: 'server_error' }], // temporary account access anomaly
  ['1230', { retryable: true, reason: 'server_error' }], // API call flow error
  ['1234', { retryable: true, reason: 'network_error' }], // network error
  ['1302', { retryable: true, reason: 'rate_limited' }], // concurrency too high
  ['1303', { retryable: true, reason: 'rate_limited' }], // call frequency too high
  ['1305', { retryable: true, reason: 'rate_limited' }], // platform traffic limit / overload
  ['1312', { retryable: true, reason: 'provider_overloaded' }], // model access load too high

  // —— 终止：重置窗口/套餐/公平使用类，重试只会浪费预算 ——
  ['1113', { retryable: false, reason: 'unknown' }], // provider-declared terminal business error
  ['1304', { retryable: false, reason: 'rate_limited' }], // daily call limit
  ['1308', { retryable: false, reason: 'rate_limited' }], // usage cap, waits for reset
  ['1309', { retryable: false, reason: 'unknown' }], // Coding Plan expired
  ['1310', { retryable: false, reason: 'rate_limited' }], // weekly/monthly quota cap
  ['1311', { retryable: false, reason: 'unknown' }], // plan lacks model permission
  ['1313', { retryable: false, reason: 'rate_limited' }], // fair usage restriction
  ['1008', { retryable: false, reason: 'unknown' }],
  ['1314', { retryable: false, reason: 'unknown' }],
  ['1315', { retryable: false, reason: 'unknown' }],
]);

// 长期配额/余额耗尽族（BigModel 数字码 + OpenAI 风格字符串码，语义同 ZCode 终止表）：
// 只能靠充值、换套餐或等待长期重置解决；其终止语义不能依赖 Retry-After 时长，
// insufficient_quota 尤其不能落进通用 429 重试。
const TERMINAL_QUOTA_CODES = [
  '2056',
  '20097',
  '1316',
  '1317',
  '1318',
  '1319',
  '1320',
  '1321',
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'exceeded_current_quota_error',
] as const;
for (const code of TERMINAL_QUOTA_CODES) {
  BUSINESS_CODES.set(code, { retryable: false, reason: 'rate_limited' });
}

// OpenAI/Anthropic 风格字符串码中保持可重试的部分（同 ZCode 表）。
BUSINESS_CODES.set('rate_limit_reached_error', { retryable: true, reason: 'rate_limited' });
BUSINESS_CODES.set('rate_limit_error', { retryable: true, reason: 'rate_limited' });
BUSINESS_CODES.set('engine_overloaded_error', { retryable: true, reason: 'provider_overloaded' });
BUSINESS_CODES.set('overloaded_error', { retryable: true, reason: 'provider_overloaded' });

/**
 * Look up the verdict for a business code. String codes are matched
 * case-insensitively; unknown codes return undefined.
 */
export function lookupBusinessCode(code: string): BusinessCodeInfo | undefined {
  return BUSINESS_CODES.get(code.trim().toLowerCase());
}

/**
 * Extract a provider business code from a raw error message: the BigModel
 * bracket prefix (`[1302][…][request_id]`, anchored at the start of the
 * text) or an OpenAI-style `code` field (JSON body or embedded). Returns
 * undefined when neither form is present.
 */
export function extractBusinessCode(errorText: string | undefined): string | undefined {
  if (!errorText) return undefined;
  const bracket = /^\s*\[(\d{4,5})\]/.exec(errorText);
  if (bracket) return bracket[1];
  return extractOpenAiStyleCode(errorText);
}

/**
 * Parse a business code out of an error message and classify it against the
 * table. Codes unknown to the table return undefined so callers fall back to
 * the HTTP-status verdict.
 */
export function classifyErrorText(
  errorText: string | undefined
): ClassifiedBusinessError | undefined {
  const code = extractBusinessCode(errorText);
  if (!code) return undefined;
  const info = lookupBusinessCode(code);
  if (!info) return undefined;
  return { code, info };
}

function extractOpenAiStyleCode(errorText: string): string | undefined {
  const fromJson = readOpenAiCodeField(parseLooseJson(errorText));
  if (fromJson) return fromJson;
  // Fallback for a JSON body embedded in a larger message, e.g.
  // '... {"error":{"message":"…","code":"insufficient_quota"}}'.
  const match = /"code"\s*:\s*(?:"([A-Za-z0-9_.-]+)"|(\d+))/.exec(errorText);
  return match?.[1] ?? match?.[2];
}

function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Reads `error.code` (OpenAI shape) or a top-level `code` from parsed JSON. */
function readOpenAiCodeField(parsed: unknown): string | undefined {
  if (parsed === null || typeof parsed !== 'object') return undefined;
  const record = parsed as Record<string, unknown>;
  const error = record.error;
  if (error !== null && typeof error === 'object') {
    const code = readCodeValue((error as Record<string, unknown>).code);
    if (code) return code;
  }
  return readCodeValue(record.code);
}

function readCodeValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}
