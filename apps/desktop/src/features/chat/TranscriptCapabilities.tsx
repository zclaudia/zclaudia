/**
 * The transcript renderers' capability context now lives in the kit, next to
 * the components that consume it. Re-exported here so this app keeps a single
 * import path for it.
 */
export {
  TranscriptCapabilitiesProvider,
  useTranscriptCapabilities,
  type TranscriptCapabilities,
} from '@zclaudia/agent-transcript-kit/react';
