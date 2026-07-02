/**
 * Auto-generated file detection.
 *
 * Prevents the agent from editing files produced by code generators
 * (protoc, sqlc, buf, swagger, mockery, …). Such edits are lost on the next
 * regeneration; the agent should change the source or generator config instead.
 */
import * as path from 'path';

/** Bytes of content inspected for header markers. */
const CHECK_BYTE_COUNT = 1024;
const HEADER_LINE_LIMIT = 40;

const KNOWN_GENERATOR_PATTERN =
  '(?:protoc(?:-gen-[\\w-]+)?|sqlc|buf|swagger(?:-codegen)?|openapi(?:-generator)?|grpc-gateway|mockery|stringer|easyjson|deepcopy-gen|defaulter-gen|conversion-gen|client-gen|lister-gen|informer-gen|kysely-codegen|napi-rs)';

// Keep these strict: broad patterns like /auto-generated/ cause false positives
// in normal hand-written files (including this guard implementation itself).
const AUTO_GENERATED_HEADER_MARKERS: readonly RegExp[] = [
  /@generated\b/i,
  /\bcode\s+generated\s+by\s+[a-z0-9_.-]+/i,
  /\bthis\s+file\s+was\s+automatically\s+generated\b/i,
  new RegExp(`\\bgenerated\\s+by\\s+${KNOWN_GENERATOR_PATTERN}\\b`, 'i'),
];

const AUTO_GENERATED_FILENAME_PATTERNS: readonly RegExp[] = [
  /^zz_generated\./,
  /\.pb\.(go|cc|h|c|js|ts)$/,
  /_pb2\.py$/,
  /_pb2_grpc\.py$/,
  /\.gen\.(go|ts|js|py)$/,
  /^generated\.(go|ts|js|py)$/,
  /\.swagger\.json$/,
  /\.openapi\.json$/,
  /\.mock\.(go|ts)$/,
  /\.mocks?\.(go|ts|js)$/,
];

type CommentStyle = 'slash' | 'hash' | 'sql' | 'html';

const COMMENT_STYLES_BY_EXTENSION = new Map<string, readonly CommentStyle[]>([
  ['.c', ['slash']],
  ['.cc', ['slash']],
  ['.cpp', ['slash']],
  ['.cs', ['slash']],
  ['.dart', ['slash']],
  ['.go', ['slash']],
  ['.h', ['slash']],
  ['.hpp', ['slash']],
  ['.java', ['slash']],
  ['.js', ['slash']],
  ['.jsx', ['slash']],
  ['.kt', ['slash']],
  ['.kts', ['slash']],
  ['.mjs', ['slash']],
  ['.cjs', ['slash']],
  ['.php', ['slash']],
  ['.rs', ['slash']],
  ['.scala', ['slash']],
  ['.swift', ['slash']],
  ['.ts', ['slash']],
  ['.tsx', ['slash']],
  ['.py', ['hash']],
  ['.rb', ['hash']],
  ['.sh', ['hash']],
  ['.bash', ['hash']],
  ['.zsh', ['hash']],
  ['.yml', ['hash']],
  ['.yaml', ['hash']],
  ['.toml', ['hash']],
  ['.ini', ['hash']],
  ['.cfg', ['hash']],
  ['.conf', ['hash']],
  ['.env', ['hash']],
  ['.pl', ['hash']],
  ['.r', ['hash']],
  ['.sql', ['sql']],
  ['.html', ['html']],
  ['.htm', ['html']],
  ['.xml', ['html']],
  ['.svg', ['html']],
  ['.xhtml', ['html']],
]);

const COMMENT_STYLES_BY_BASENAME = new Map<string, readonly CommentStyle[]>([
  ['dockerfile', ['hash']],
  ['makefile', ['hash']],
  ['justfile', ['hash']],
]);

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function commentStylesForPath(filePath: string): readonly CommentStyle[] {
  const fileName = path.basename(filePath).toLowerCase();
  const byName = COMMENT_STYLES_BY_BASENAME.get(fileName);
  if (byName) return byName;
  return COMMENT_STYLES_BY_EXTENSION.get(path.extname(fileName)) ?? [];
}

/** Collect the leading comment block (header) of the file, shebang-aware. */
function extractLeadingHeaderCommentText(
  content: string,
  commentStyles: readonly CommentStyle[]
): string {
  if (commentStyles.length === 0) return '';

  const includeSlash = commentStyles.includes('slash');
  const includeHash = commentStyles.includes('hash');
  const includeSql = commentStyles.includes('sql');
  const includeHtml = commentStyles.includes('html');

  const lines = stripBom(content).split(/\r?\n/);
  const headerLines: string[] = [];
  let started = false;
  let inSlashBlock = false;
  let inHtmlBlock = false;

  for (
    let lineIndex = 0;
    lineIndex < lines.length && lineIndex < HEADER_LINE_LIMIT;
    lineIndex += 1
  ) {
    const trimmed = lines[lineIndex]?.trim() ?? '';
    if (lineIndex === 0 && trimmed.startsWith('#!')) continue;

    if (inSlashBlock) {
      headerLines.push(trimmed);
      if (trimmed.includes('*/')) inSlashBlock = false;
      continue;
    }
    if (inHtmlBlock) {
      headerLines.push(trimmed);
      if (trimmed.includes('-->')) inHtmlBlock = false;
      continue;
    }
    if (trimmed.length === 0) {
      if (started) headerLines.push('');
      continue;
    }
    if (includeSlash && trimmed.startsWith('//')) {
      started = true;
      headerLines.push(trimmed);
      continue;
    }
    if (includeSlash && trimmed.startsWith('/*')) {
      started = true;
      headerLines.push(trimmed);
      if (!trimmed.includes('*/')) inSlashBlock = true;
      continue;
    }
    if (includeHash && trimmed.startsWith('#')) {
      started = true;
      headerLines.push(trimmed);
      continue;
    }
    if (includeSql && trimmed.startsWith('--')) {
      started = true;
      headerLines.push(trimmed);
      continue;
    }
    if (includeHtml && trimmed.startsWith('<!--')) {
      started = true;
      headerLines.push(trimmed);
      if (!trimmed.includes('-->')) inHtmlBlock = true;
      continue;
    }
    break;
  }

  return headerLines.join('\n');
}

/**
 * Detect whether a file looks auto-generated, by filename pattern or by a
 * generator marker in its leading header comment. Returns the matched marker
 * text, or undefined when the file looks hand-written.
 *
 * @param content Current file content; pass null for files that do not exist yet.
 */
export function findAutoGeneratedMarker(
  filePath: string,
  content?: string | null
): string | undefined {
  const fileName = path.basename(filePath);
  if (AUTO_GENERATED_FILENAME_PATTERNS.some(pattern => pattern.test(fileName))) {
    return fileName;
  }
  if (typeof content !== 'string' || !content) return undefined;

  const prefix = content.slice(0, CHECK_BYTE_COUNT);
  const headerText = extractLeadingHeaderCommentText(prefix, commentStylesForPath(filePath));
  if (!headerText) return undefined;
  for (const markerPattern of AUTO_GENERATED_HEADER_MARKERS) {
    const match = markerPattern.exec(headerText);
    if (match?.[0]) return match[0];
  }
  return undefined;
}

export function buildAutoGeneratedMessage(displayPath: string, marker: string): string {
  return (
    `Cannot modify auto-generated file: ${displayPath} (detected marker: "${marker}"). ` +
    'Auto-generated files should not be edited directly — find the source file or generator ' +
    'configuration, change that, and regenerate.'
  );
}
