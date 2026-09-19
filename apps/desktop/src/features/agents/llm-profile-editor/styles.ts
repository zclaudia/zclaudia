// Shared field styling for the LLM profile editor's form grammar.
import { FIELD_CLASS_LG } from '../../../components/ui/Input';

/** Field styling shared with the agent profile editor (ProfileEditor).
 *  Comfortable-density variant of the app's single field grammar (ui/Input). */
export const FIELD_CLASS = FIELD_CLASS_LG;
export const MONO_FIELD_CLASS = `${FIELD_CLASS} font-mono`;
/** Compact variant for the dense model-row grid; append a border-color class. */
export const MODEL_FIELD_BASE =
  'w-full rounded-md border bg-background/70 px-2 py-1.5 text-sm text-foreground shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50';
