import type { ToolExecutionObserver } from '../../../infra/providers/pi-runtime/index.js';
import {
  activateConditionalSkillsForPaths,
  activateConditionalSkillsForToolNames,
} from '../../plugins/skill-tools.js';

export function createSkillActivationObserver(): ToolExecutionObserver {
  return {
    afterToolExecute: ({ toolName, cwd, touchedPaths }) => {
      if (touchedPaths.length > 0) activateConditionalSkillsForPaths(touchedPaths, cwd);
      activateConditionalSkillsForToolNames([toolName]);
    },
  };
}
