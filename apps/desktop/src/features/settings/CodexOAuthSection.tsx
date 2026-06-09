import { useState, useEffect } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { CodexOAuthCard } from './CodexOAuthCard';
import { CodexOAuthLoginModal } from './CodexOAuthLoginModal';
import {
  fetchCodexModels,
  signOutCodexOAuth,
  type CodexModelEntry,
} from '../../services/api/llm-profiles';
import type { LlmProfileConfig } from '@zclaudia/shared';

interface Props {
  profile: LlmProfileConfig;
  onCredentialsChanged: () => void;
  /**
   * Optional callback run when the user clicks Sign in, BEFORE the OAuth modal
   * opens. Used by the form to persist draft changes (e.g. provider_type
   * transition to openai-codex) to the server first so the OAuth start endpoint
   * sees the correct profile type. Return the saved profile (so we use its id
   * for the modal) or null to abort the sign-in.
   */
  onBeforeSignIn?: () => Promise<LlmProfileConfig | null>;
}

function detectIsTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function CodexOAuthSection({ profile, onCredentialsChanged, onBeforeSignIn }: Props) {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const isCurrentLocalServer = activeServerId === 'local';
  const isTauri = detectIsTauri();
  const method: 'browser' | 'device_code' =
    isTauri && isCurrentLocalServer ? 'browser' : 'device_code';

  const [showLogin, setShowLogin] = useState(false);
  // The profile id used by the login modal. Defaults to props.profile.id but
  // gets overridden by whatever onBeforeSignIn persists, so a draft type change
  // takes effect even before the parent's re-render delivers the new prop.
  const [activeProfileId, setActiveProfileId] = useState(profile.id);
  const [signInPending, setSignInPending] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [models, setModels] = useState<CodexModelEntry[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);

  async function handleSignIn() {
    let idToUse = profile.id;
    setSignInError(null);
    if (onBeforeSignIn) {
      setSignInPending(true);
      try {
        const saved = await onBeforeSignIn();
        if (saved) {
          idToUse = saved.id;
        } else {
          setSignInError('登录前保存 Profile 失败，请先修正表单错误。');
          return;
        }
      } catch (err) {
        console.error('[CodexOAuthSection] onBeforeSignIn threw', err);
        setSignInError(err instanceof Error ? err.message : '登录前保存 Profile 失败，请稍后重试。');
        return;
      } finally {
        setSignInPending(false);
      }
    }
    setActiveProfileId(idToUse);
    setShowLogin(true);
  }

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
    await signOutCodexOAuth(profile.id);
    onCredentialsChanged();
  }

  return (
    <div className="space-y-4">
      <CodexOAuthCard
        profile={profile}
        isCurrentLocalServer={isCurrentLocalServer}
        isTauri={isTauri}
        onSignIn={() => void handleSignIn()}
        onSignOut={handleSignOut}
        inFlight={showLogin || signInPending}
      />
      {signInError && (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
          {signInError}
        </div>
      )}

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
          profileId={activeProfileId}
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
