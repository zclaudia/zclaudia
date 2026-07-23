import { useState, useEffect } from 'react';
import { useConnection } from '../../contexts/ConnectionContext';
import { useFacadeStore } from '../../stores/facadeStore';
import type { SdkVersionReport } from '@zclaudia/shared';
import * as api from '../../services/api';
import { SettingsGroup, SettingsRow } from './ui/SettingsGroup';

interface AboutSettingsProps {
  isOpen: boolean;
}

/** About tab: app version plus SDK version check against the local embedded server. */
export function AboutSettings({ isOpen }: AboutSettingsProps) {
  const { embeddedServerPort } = useConnection();
  const localBackendExists = useFacadeStore(
    s =>
      !!s.localBackendId || s.backends.some(b => b.isThisInstance === true || b.channel === 'local')
  );

  // SDK version check
  const [sdkVersions, setSdkVersions] = useState<SdkVersionReport | null>(null);
  useEffect(() => {
    if (!isOpen || !localBackendExists || !embeddedServerPort) return;
    const address = `localhost:${embeddedServerPort}`;
    api
      .getServerInfo(address)
      .then(info => setSdkVersions(info.sdkVersions ?? null))
      .catch(() => setSdkVersions(null));
  }, [isOpen, localBackendExists, embeddedServerPort]);

  return (
    <div className="space-y-6">
      <SettingsGroup label="About">
        <SettingsRow
          align="start"
          title="Version"
          control={<span className="text-sm">{__APP_VERSION__}</span>}
        >
          {sdkVersions && sdkVersions.sdks.length > 0 && (
            <div className="space-y-2 border-t border-border/50 pt-2">
              {sdkVersions.sdks.map(sdk => (
                <div key={sdk.name} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{sdk.name}</span>
                  <span className={sdk.outdated ? 'text-amber-500' : 'text-muted-foreground'}>
                    {sdk.current}
                    {sdk.outdated ? ` → ${sdk.latest}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
