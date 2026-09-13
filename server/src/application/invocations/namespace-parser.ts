/**
 * Reserved-namespace lexical parser (URIP design doc §12.2).
 *
 * Recognizes ONLY a token at byte zero matching `/zc:<name>`, `/skill:<name>`,
 * or `/<active-runtime-type>:<name>` followed by end-of-input or whitespace.
 * It never interprets unqualified `/name`, Markdown found later in a message,
 * or a prefix for an inactive runtime. The argument suffix after the token is
 * preserved byte-for-byte.
 */

export type ReservedNamespace = 'zc' | 'skill' | 'runtime';

export interface ParsedReservedInvocation {
  namespace: ReservedNamespace;
  /** Name after the namespace prefix, lowercased for lookup (display stays verbatim). */
  name: string;
  /** Raw text as the user typed it (case preserved). */
  rawName: string;
  /** Everything after the token, byte-for-byte (no leading-space trimming). */
  argumentSuffix: string;
}

interface ParseOptions {
  /** Active runtime type for `/<runtime>:<name>` recognition (e.g. 'claude'). */
  activeRuntimeType: string;
}

const NAMESPACE_PATTERN = /^\/([A-Za-z][A-Za-z0-9_-]*):([^\s]*)/;

export function parseReservedNamespace(
  input: string,
  options: ParseOptions
): ParsedReservedInvocation | null {
  if (typeof input !== 'string' || !input.startsWith('/')) return null;
  const match = NAMESPACE_PATTERN.exec(input);
  if (!match) return null;
  const [, namespaceToken, name] = match;
  if (!name) return null;

  const isHost = namespaceToken === 'zc';
  const isPortableSkill = namespaceToken === 'skill';
  const isActiveRuntime = options.activeRuntimeType && namespaceToken === options.activeRuntimeType;
  if (!isHost && !isPortableSkill && !isActiveRuntime) return null;

  const consumedLength = match[0].length;
  let argumentSuffix = input.slice(consumedLength);
  // Preserve the argument suffix byte-for-byte except a single separating
  // space directly after the token, which is structural, not content.
  if (argumentSuffix.startsWith(' ')) argumentSuffix = argumentSuffix.slice(1);

  return {
    namespace: isHost ? 'zc' : isPortableSkill ? 'skill' : 'runtime',
    name: name.toLowerCase(),
    rawName: name,
    argumentSuffix,
  };
}
