import type { LlmProfileConfig } from '@zclaudia/shared';

/**
 * Soft warning shown beneath the model input when the agent profile's selected
 * model id is not declared on the bound LLM profile's `models` list. We skip
 * the warning when the LLM profile is missing, its `models` list is undefined
 * or empty (backwards-compat / undeclared profile), or the model input is
 * blank.
 */
export function ModelDeclarationWarning({
  formModel,
  llmProfile,
}: {
  formModel: string;
  llmProfile: LlmProfileConfig | undefined;
}) {
  const trimmed = formModel.trim();
  if (!trimmed) return null;
  const models = llmProfile?.models;
  if (!models || models.length === 0) return null;
  const known = models.some(m => m.modelId === trimmed);
  if (known) return null;
  return (
    <p className="text-xs text-warning mt-1">
      This model is not declared on the selected LLM profile. The agent will work but will fall back
      to pi-ai registry defaults for context window / max tokens.
    </p>
  );
}
