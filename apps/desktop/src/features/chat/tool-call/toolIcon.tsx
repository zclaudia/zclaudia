import type { ReactNode } from 'react';
import { getToolIcon } from '../../../config/icons';
import { Icon } from '../../../components/ui/Icon';

/**
 * This app's tool icons, injected into the kit's renderers through
 * TranscriptCapabilities. The kit renders whatever comes back, so the icon set
 * and its component stay entirely on this side.
 */
export function toolIcon(toolName: string): ReactNode {
  return <Icon icon={getToolIcon(toolName)} size={14} />;
}
