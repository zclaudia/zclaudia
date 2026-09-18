// Shared field/popover styling for the profile editor's form grammar.
import { FIELD_CLASS_LG } from '../../../components/ui/Input';

/** Comfortable-density variant of the app's single field grammar (ui/Input). */
export const FIELD_CLASS = FIELD_CLASS_LG;
export const MONO_FIELD_CLASS = `${FIELD_CLASS} font-mono`;
/**
 * Dropdown surface for the custom selectors below.
 *
 * Anchored to the trigger's right edge with a minimum width instead of simply
 * matching it: the triggers sit in a ~176px column at phone width, which is
 * plenty for the current value but far too narrow to browse full model ids in.
 * Growing leftwards keeps the panel on screen (the column's right edge is one
 * page gutter from the viewport edge).
 */
export const SELECT_POPOVER_CLASS =
  'absolute right-0 top-full mt-1 min-w-[min(20rem,calc(100vw-2.5rem))] md:left-0 md:min-w-0 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl animate-apple-fade-in z-50 py-1 overflow-hidden';
