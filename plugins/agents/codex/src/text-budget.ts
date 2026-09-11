import {
  DEFAULT_DELTA_BYTES,
  DEFAULT_TOOL_INPUT_BYTES,
  DEFAULT_TOOL_RESULT_BYTES,
} from '@zclaudia/agent-common';

export { boundedJsonText, boundedToolInput, truncateUtf8 } from '@zclaudia/agent-common';

export const MAX_CODEX_DELTA_BYTES = DEFAULT_DELTA_BYTES;
export const MAX_CODEX_TOOL_INPUT_BYTES = DEFAULT_TOOL_INPUT_BYTES;
export const MAX_CODEX_TOOL_RESULT_BYTES = DEFAULT_TOOL_RESULT_BYTES;
