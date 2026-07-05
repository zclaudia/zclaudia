/**
 * Codex OAuth Section (backend-scoped)
 *
 * Copy-adapted from the settings Providers tab's section: gains a `backendId`
 * prop and talks to the ForBackend API variants so credential + model calls
 * target the backend that owns the profile rather than the active server.
 */

import { useState, useEffect } from 'react';
import { CodexOAuthCard } from './CodexOAuthCard';
import { CodexOAuthLoginModal } from './CodexOAuthLoginModal';
import {
  fetchCodexModelsForBackend,
  signOutCodexOAuthForBackend,
  updateLlmProfileForBackend,
  type CodexModelEntry,
} from '../../services/api';
import { isLocalBackendId } from '../../utils/controlPlane';
import type { LlmProfileConfig, LlmProfileModelEntry } from '@zclaudia/shared';

interface Props {
  backendId: string;
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

function codexModelsToProfileEntries(models: CodexModelEntry[]): LlmProfileModelEntry[] {
  return models.map(m => ({
    modelId: m.id,
    displayName: m.displayName && m.displayName !== m.id ? m.displayName : undefined,
    contextWindow: m.contextWindow,
  }));
}

function sameProfileModels(
  a: LlmProfileModelEntry[] | undefined,
  b: LlmProfileModelEntry[]
): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.modelId !== right.modelId ||
      left.displayName !== right.displayName ||
      left.contextWindow !== right.contextWindow ||
      left.maxTokens !== right.maxTokens
    ) {
      return false;
    }
  }
  return true;
}

export function CodexOAuthSection({
  backendId,
  profile,
  onCredentialsChanged,
  onBeforeSignIn,
}: Props) {
  // The settings-era section keyed the OAuth method off `activeServerId ===
  // 'local'` (browser flow only when the profile lives on this machine's
  // embedded server; device-code otherwise, since a remote backend can't open
  // a local browser + serve the loopback callback). Here the profile's backend
  // is an explicit prop, so we ask `isLocalBackendId` — the canonical
  // localness check for an explicit id (handles the legacy 'local'/'__local__'
  // ids plus the facade's localBackendId / isThisInstance / channel==='local'
  // fallbacks). Non-reactive by design: backendId is fixed for the lifetime of
  // a keyed-remount editor, and a given backend id never changes localness.
  const isCurrentLocalServer = isLocalBackendId(backendId);
  const isTauri = detectIsTauri();
  const method: 'browser' | 'device_code' = isCurrentLocalServer ? 'browser' : 'device_code';

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
          setSignInError(
            'Failed to save the profile before signing in. Please fix the form errors first.'
          );
          return;
        }
      } catch (err) {
        console.error('[CodexOAuthSection] onBeforeSignIn threw', err);
        setSignInError(
          err instanceof Error
            ? err.message
            : 'Failed to save the profile before signing in. Please try again later.'
        );
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
      const result = await fetchCodexModelsForBackend(backendId, profile.id, { refresh });
      setModels(result.models);
      const profileModels = codexModelsToProfileEntries(result.models);
      if (!sameProfileModels(profile.models, profileModels)) {
        try {
          await updateLlmProfileForBackend(backendId, profile.id, { models: profileModels });
          onCredentialsChanged();
        } catch (err) {
          console.warn('[CodexOAuthSection] failed to sync codex models to profile', err);
        }
      }
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
  }, [backendId, profile.id, profile.oauthCredentials?.access]);

  async function handleSignOut() {
    await signOutCodexOAuthForBackend(backendId, profile.id);
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
            {models?.map(m => (
              <li key={m.id} className="flex justify-between border-b border-border py-1">
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
            {models === null && <li className="text-xs text-muted-foreground">Loading…</li>}
          </ul>
        </div>
      )}

      {showLogin && (
        <CodexOAuthLoginModal
          backendId={backendId}
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
