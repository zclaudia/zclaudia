import { ShieldCheck } from 'lucide-react';

export function PluginPermissionsPreview({ permissions }: { permissions: string[] }) {
  if (permissions.length === 0) {
    return <p className="text-[11px] text-muted-foreground">No plugin permissions requested.</p>;
  }

  return (
    <div className="space-y-1.5">
      {permissions.map(permission => (
        <div
          key={permission}
          className="flex items-center gap-2 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-xs"
        >
          <ShieldCheck className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />
          <span className="font-mono text-foreground">{permission}</span>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">
        Installation does not grant these permissions. Claudia asks when the plugin first uses
        them.
      </p>
    </div>
  );
}
