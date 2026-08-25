import { createContext, useContext } from 'react';

/**
 * Host capabilities for transcript renderers.
 *
 * Layer-3 prerequisite: renderers buried inside the markdown component map
 * (CodeBlock and friends) cannot receive props directly, so capabilities
 * travel by context instead. The point is ownership — this context is
 * declared alongside the renderers and will move with them into the shared
 * component package, unlike the app's ConnectionContext / ThemeContext /
 * store hooks, which are zclaudia-specific and must not follow.
 *
 * Everything here is optional: a renderer gates the affordance on presence,
 * so a host that cannot paste into a terminal simply omits `runInTerminal`
 * and no button appears.
 */
export interface TranscriptCapabilities {
  /** Paste a command/snippet into the host's terminal. */
  runInTerminal?: (command: string) => void;
  /** Code highlighting theme, expressed neutrally (no host theme types). */
  isDarkCode?: boolean;
}

const TranscriptCapabilitiesContext = createContext<TranscriptCapabilities>({});

export const TranscriptCapabilitiesProvider = TranscriptCapabilitiesContext.Provider;

export function useTranscriptCapabilities(): TranscriptCapabilities {
  return useContext(TranscriptCapabilitiesContext);
}
