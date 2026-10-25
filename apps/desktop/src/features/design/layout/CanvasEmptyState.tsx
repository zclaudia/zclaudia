import { Sparkles } from 'lucide-react';
import { Button } from '../../../components/ui/Button';

/** 画布空态：Agent 生成 / 模板起步两个入口，不用实心主按钮。 */
export function CanvasEmptyState({
  onGenerate,
  onTemplate,
}: {
  onGenerate: () => void;
  onTemplate: () => void;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
        <Sparkles size={20} strokeWidth={1.75} className="text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-sm font-medium text-foreground">
          Describe a page and let the Agent build it
        </h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          The canvas is empty. Generate a page from your prompt, or start from a template.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onGenerate}
          aria-label="Ask Agent to build a page"
        >
          Ask Agent
        </Button>
        <Button variant="outline" size="sm" onClick={onTemplate} aria-label="Start from template">
          Templates
        </Button>
      </div>
    </div>
  );
}
