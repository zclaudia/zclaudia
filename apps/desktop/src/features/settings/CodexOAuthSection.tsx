import { useState, useEffect } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { CodexOAuthCard } from './CodexOAuthCard';
import { CodexOAuthLoginModal } from './CodexOAuthLoginModal';
import {
  fetchCodexModels,
  updateLlmProfile,
  type CodexModelEntry,
} from '../../services/api/llm-profiles';
import type { LlmProfileConfig } from '@zclaudia/shared';

interface Props {
  profile: LlmProfileConfig;
  onCredentialsChanged: () => void;
}

function detectIsTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function CodexOAuthSection({ profile, onCredentialsChanged }: Props) {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const isCurrentLocalServer = activeServerId === 'local';
  const isTauri = detectIsTauri();
  const method: 'browser' | 'device_code' =
    isTauri && isCurrentLocalServer ? 'browser' : 'device_code';

  const [showLogin, setShowLogin] = useState(false);
  const [models, setModels] = useState<CodexModelEntry[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);

  async function loadModels(refresh = false) {
    if (!profile.oauthCredentials) {
      setModels(null);
      return;
    }
    setModelsLoading(true);
    try {
      const result = await fetchCodexModels(profile.id, { refresh });
      setModels(result.models);
    } catch {
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }

  useEffect(() => {
    void loadModels(false);
    // Re-fetch when the access token changes (i.e. after a successful sign-in or refresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, profile.oauthCredentials?.access]);

  async function handleSignOut() {
    // Clear credentials by patching oauthCredentials to undefined
    await updateLlmProfile(profile.id, { oauthCredentials: undefined } as Partial<LlmProfileConfig>);
    onCredentialsChanged();
  }

  return (
    <div className="space-y-4">
      <CodexOAuthCard
        profile={profile}
        isCurrentLocalServer={isCurrentLocalServer}
        isTauri={isTauri}
        onSignIn={() => setShowLogin(true)}
        onSignOut={handleSignOut}
        inFlight={showLogin}
      />

      {profile.oauthCredentials && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-medium text-muted-foreground">Available Models</h4>
            <button
              type="button"
              onClick={() => void loadModels(true)}
              disabled={modelsLoading}
              className="text-xs text-emerald-600 underline disabled:opacity-50 dark:text-emerald-400"
            >
              {modelsLoading ? 'Refreshing…' : 'Refresh model list'}
            </button>
          </div>
          <ul className="text-sm">
            {models?.map((m) => (
              <li
                key={m.id}
                className="flex justify-between border-b border-border py-1"
              >
                <span>
                  <code className="font-mono text-xs">{m.id}</code>
                  {m.displayName && m.displayName !== m.id ? ` — ${m.displayName}` : ''}
                </span>
                <span className="text-xs text-muted-foreground">
                  {(m.contextWindow / 1000).toFixed(0)}k ctx
                </span>
              </li>
            ))}
            {models !== null && models.length === 0 && (
              <li className="text-xs text-muted-foreground">No models detected</li>
            )}
            {models === null && (
              <li className="text-xs text-muted-foreground">Loading…</li>
            )}
          </ul>
        </div>
      )}

      {showLogin && (
        <CodexOAuthLoginModal
          profileId={profile.id}
          method={method}
          isTauri={isTauri}
          onClose={() => setShowLogin(false)}
          onSuccess={(_accountId: string) => {
            setShowLogin(false);
            onCredentialsChanged();
          }}
        />
      )}
    </div>
  );
}
