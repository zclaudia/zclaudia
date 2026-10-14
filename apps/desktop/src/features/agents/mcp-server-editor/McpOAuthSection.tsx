import { EditorSection } from '../ui/EditorSection';
import { FormField } from '../../../components/ui/FormField';
import { Input } from '../../../components/ui/Input';

/**
 * "Authentication" section of the MCP server editor: the OAuth enable toggle
 * and — when enabled — the discovery/client fields of the server's oauthConfig
 * draft. Rendered for remote transports only (the parent gates on transport).
 *
 * Purely presentational: every field value and its setter is owned by the
 * parent form so the autosave signature and payload stay in one place.
 */
export function McpOAuthSection({
  enabled,
  onEnabledChange,
  metadataUrl,
  onMetadataUrlChange,
  authorizationEndpoint,
  onAuthorizationEndpointChange,
  tokenEndpoint,
  onTokenEndpointChange,
  deviceAuthorizationEndpoint,
  onDeviceAuthorizationEndpointChange,
  clientId,
  onClientIdChange,
  clientSecret,
  onClientSecretChange,
  scopes,
  onScopesChange,
  onFlush,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  metadataUrl: string;
  onMetadataUrlChange: (value: string) => void;
  authorizationEndpoint: string;
  onAuthorizationEndpointChange: (value: string) => void;
  tokenEndpoint: string;
  onTokenEndpointChange: (value: string) => void;
  deviceAuthorizationEndpoint: string;
  onDeviceAuthorizationEndpointChange: (value: string) => void;
  clientId: string;
  onClientIdChange: (value: string) => void;
  clientSecret: string;
  onClientSecretChange: (value: string) => void;
  scopes: string;
  onScopesChange: (value: string) => void;
  onFlush: () => void;
}) {
  return (
    <EditorSection title="Authentication">
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground max-md:py-2">
        <input
          type="checkbox"
          aria-label="Enable OAuth"
          checked={enabled}
          onChange={e => onEnabledChange(e.target.checked)}
          className="rounded border-border bg-secondary/50"
        />
        Enable OAuth
      </label>
      {enabled && (
        <div className="grid gap-2 md:grid-cols-2">
          <div className="md:col-span-2">
            <FormField label="Metadata URL">
              {f => (
                <Input
                  {...f}
                  type="text"
                  value={metadataUrl}
                  onChange={e => onMetadataUrlChange(e.target.value)}
                  onBlur={onFlush}
                  placeholder="https://auth.example.com/.well-known/…"
                  className="text-xs font-mono"
                />
              )}
            </FormField>
          </div>
          <FormField label="Authorization Endpoint">
            {f => (
              <Input
                {...f}
                type="text"
                value={authorizationEndpoint}
                onChange={e => onAuthorizationEndpointChange(e.target.value)}
                onBlur={onFlush}
                placeholder="https://auth.example.com/oauth/authorize"
                className="text-xs font-mono"
              />
            )}
          </FormField>
          <FormField label="Token Endpoint">
            {f => (
              <Input
                {...f}
                type="text"
                value={tokenEndpoint}
                onChange={e => onTokenEndpointChange(e.target.value)}
                onBlur={onFlush}
                placeholder="https://auth.example.com/oauth/token"
                className="text-xs font-mono"
              />
            )}
          </FormField>
          <FormField label="Device Authorization Endpoint">
            {f => (
              <Input
                {...f}
                type="text"
                value={deviceAuthorizationEndpoint}
                onChange={e => onDeviceAuthorizationEndpointChange(e.target.value)}
                onBlur={onFlush}
                placeholder="https://auth.example.com/oauth/device"
                className="text-xs font-mono"
              />
            )}
          </FormField>
          <FormField label="Client ID">
            {f => (
              <Input
                {...f}
                type="text"
                value={clientId}
                onChange={e => onClientIdChange(e.target.value)}
                onBlur={onFlush}
                placeholder="zclaudia-client-id"
                className="text-xs font-mono"
              />
            )}
          </FormField>
          <FormField label="Client Secret">
            {f => (
              <Input
                {...f}
                type="password"
                value={clientSecret}
                onChange={e => onClientSecretChange(e.target.value)}
                onBlur={onFlush}
                placeholder="client secret (optional)"
                className="text-xs font-mono"
              />
            )}
          </FormField>
          <FormField label="Scopes">
            {f => (
              <Input
                {...f}
                type="text"
                value={scopes}
                onChange={e => onScopesChange(e.target.value)}
                onBlur={onFlush}
                placeholder="repo read:user"
                className="text-xs font-mono"
              />
            )}
          </FormField>
        </div>
      )}
    </EditorSection>
  );
}
