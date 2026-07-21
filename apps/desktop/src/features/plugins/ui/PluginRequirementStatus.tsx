import { AlertTriangle, CheckCircle2, Terminal } from 'lucide-react';
import type { PluginRequirementStatus } from '../../../services/api/plugin-packages';

export function PluginRequirementStatus({
  requirements,
}: {
  requirements: PluginRequirementStatus[];
}) {
  if (requirements.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">No external CLI requirement declared.</p>
    );
  }

  return (
    <div className="space-y-2">
      {requirements.map(requirement => (
        <div
          key={requirement.name}
          className="flex items-start gap-2 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2"
        >
          <Terminal className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <span className="font-mono">{requirement.name}</span>
              {requirement.found ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-label="Available" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-label="Missing" />
              )}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {requirement.path ?? 'Not found on PATH. Install it before activating this plugin.'}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
