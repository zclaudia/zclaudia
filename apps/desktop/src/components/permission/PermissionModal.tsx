import { useState, useEffect, useRef } from 'react';
import { Clock, Lock, TriangleAlert } from 'lucide-react';
import { parseToolRule, suggestRuleForRequest } from '@zclaudia/shared';
import { PermissionDetailView } from './PermissionDetailView';

interface PermissionRequest {
  requestId: string;
  serverId?: string;
  backendName?: string;
  toolName: string;
  detail: string;
  timeoutSec: number;
  requiresCredential?: boolean;
  credentialHint?: string;
  aiInitiated?: boolean;
}

interface PermissionModalProps {
  request: PermissionRequest | null;
  queueSize?: number;
  onDecision: (
    requestId: string,
    allow: boolean,
    remember?: boolean,
    credential?: string,
    feedback?: string,
    promoteRule?: string
  ) => void;
}

export function PermissionModal({ request, queueSize = 0, onDecision }: PermissionModalProps) {
  const [remainingTime, setRemainingTime] = useState(0);
  const [remember, setRemember] = useState(false);
  const [credential, setCredential] = useState('');
  const [promoteAlways, setPromoteAlways] = useState(false);
  const [promoteRuleText, setPromoteRuleText] = useState('');
  const credentialInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!request) return;

    setRemember(false);
    setCredential('');
    setPromoteAlways(false);
    setPromoteRuleText('');

    // timeoutSec = 0 means no timeout (wait indefinitely like official Claude client)
    if (request.timeoutSec === 0) {
      setRemainingTime(0);
      // Focus password input if credential is required
      if (request.requiresCredential) {
        setTimeout(() => credentialInputRef.current?.focus(), 100);
      }
      return; // Don't start countdown timer
    }

    setRemainingTime(request.timeoutSec);

    if (request.requiresCredential) {
      setTimeout(() => credentialInputRef.current?.focus(), 100);
    }

    const interval = setInterval(() => {
      setRemainingTime(prev => {
        if (prev <= 1) {
          // Backend handles auto-approve; for auto-deny, also trigger from frontend as fallback
          if (!request.aiInitiated) {
            onDecision(request.requestId, false);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [request, onDecision]);

  if (!request) return null;

  const promoteRuleValid = !promoteAlways || parseToolRule(promoteRuleText).ok;
  const promoteRuleError =
    promoteAlways && !parseToolRule(promoteRuleText).ok
      ? (parseToolRule(promoteRuleText) as { ok: false; error: string }).error
      : undefined;

  const handleAllow = () => {
    const ruleArg = promoteAlways ? promoteRuleText : undefined;
    if (request.requiresCredential) {
      if (ruleArg !== undefined) {
        onDecision(request.requestId, true, remember, credential || undefined, undefined, ruleArg);
      } else if (credential) {
        onDecision(request.requestId, true, remember, credential);
      } else {
        onDecision(request.requestId, true, remember);
      }
    } else {
      if (ruleArg !== undefined) {
        onDecision(request.requestId, true, remember, undefined, undefined, ruleArg);
      } else {
        onDecision(request.requestId, true, remember);
      }
    }
  };

  const handleDeny = () => {
    onDecision(request.requestId, false, remember);
  };

  // Calculate progress percent only when timeout is set
  const hasTimeout = request.timeoutSec > 0;
  const progressPercent = hasTimeout ? (remainingTime / request.timeoutSec) * 100 : 0;

  const credentialLabel =
    request.credentialHint === 'sudo_password' ? 'sudo password' : 'credential';

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50" />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 safe-top-pad safe-bottom-pad">
        <div
          data-testid="permission-dialog"
          className="w-[450px] max-w-[calc(100vw-2rem)] bg-card border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
          style={{
            maxHeight:
              'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
          }}
        >
          {/* Timeout progress bar - only show when timeout is set */}
          {hasTimeout && (
            <div className="h-1 bg-muted">
              <div
                className={`h-full transition-all duration-1000 ease-linear ${request.aiInitiated ? 'bg-success' : 'bg-warning'}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}

          {/* Header */}
          <div className="px-5 pt-4 pb-3 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  request.requiresCredential ? 'bg-amber-500/20' : 'bg-warning/20'
                }`}
              >
                {request.requiresCredential ? (
                  <Lock className="w-5 h-5 text-warning" strokeWidth={1.75} />
                ) : (
                  <TriangleAlert className="w-5 h-5 text-warning" strokeWidth={1.75} />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-card-foreground">
                    {request.requiresCredential ? 'Credential Required' : 'Permission Required'}
                  </h2>
                  {queueSize > 1 && (
                    <span className="px-1.5 py-0.5 bg-warning/20 text-warning text-xs rounded-md font-medium">
                      +{queueSize - 1} more
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {request.requiresCredential
                    ? `This command requires your ${credentialLabel}`
                    : 'Claude wants to use a tool that requires your approval'}
                </p>
                {request.backendName && (
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                    <span className="truncate">From: {request.backendName}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="px-5 py-3 border-t border-b border-border flex-1 overflow-y-auto">
            {/* Tool name */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm text-muted-foreground">Tool:</span>
              <span className="px-2 py-0.5 bg-muted rounded-md text-sm font-mono text-foreground">
                {request.toolName}
              </span>
            </div>

            {/* Detail */}
            <PermissionDetailView
              toolName={request.toolName}
              detail={request.detail}
              maxHeightClass="max-h-48"
            />

            {/* Credential input - only show when required */}
            {request.requiresCredential && (
              <div className="mt-3">
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                  Enter {credentialLabel}
                </label>
                <input
                  ref={credentialInputRef}
                  type="password"
                  value={credential}
                  onChange={e => setCredential(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && credential) handleAllow();
                  }}
                  placeholder={`Your ${credentialLabel}`}
                  autoComplete="off"
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Encrypted end-to-end — only the server can decrypt
                </p>
              </div>
            )}

            {/* Timeout warning - show different message based on timeout setting */}
            <div className="mt-3 flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-warning" strokeWidth={1.75} />
              {hasTimeout ? (
                <span className="text-muted-foreground">
                  {request.aiInitiated ? 'Auto-approve in' : 'Auto-deny in'}{' '}
                  <span
                    className={
                      request.aiInitiated
                        ? remainingTime <= 10
                          ? 'text-success font-semibold'
                          : 'text-success/80'
                        : remainingTime <= 10
                          ? 'text-destructive font-semibold'
                          : 'text-warning'
                    }
                  >
                    {remainingTime}s
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">Waiting for your decision</span>
              )}
            </div>
          </div>

          {/* Remember checkbox */}
          <div className="px-5 pt-3 pb-1 flex-shrink-0">
            <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => {
                  setRemember(e.target.checked);
                  if (e.target.checked) {
                    setPromoteAlways(false);
                    setPromoteRuleText('');
                  }
                }}
                className="w-5 h-5 rounded-md border-input bg-background text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground">
                Remember this decision for this session
              </span>
            </label>
          </div>

          {/* Always-allow checkbox */}
          <div className="px-5 pb-3 flex-shrink-0">
            <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
              <input
                type="checkbox"
                aria-label="Always allow in this project"
                checked={promoteAlways}
                onChange={e => {
                  setPromoteAlways(e.target.checked);
                  if (e.target.checked) {
                    setRemember(false);
                    setPromoteRuleText(suggestRuleForRequest(request.toolName, request.detail));
                  } else {
                    setPromoteRuleText('');
                  }
                }}
                className="w-5 h-5 rounded-md border-input bg-background text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground">Always allow in this project</span>
            </label>
            {promoteAlways && (
              <div className="mt-1 ml-8">
                <input
                  type="text"
                  value={promoteRuleText}
                  onChange={e => setPromoteRuleText(e.target.value)}
                  className={`w-full px-3 py-1.5 bg-input border rounded-lg text-sm font-mono text-foreground focus:outline-none focus:ring-1 ${
                    promoteRuleError
                      ? 'border-destructive focus:border-destructive focus:ring-destructive'
                      : 'border-border focus:border-primary focus:ring-primary'
                  }`}
                />
                {promoteRuleError && (
                  <p className="text-[11px] text-destructive mt-1">{promoteRuleError}</p>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="px-5 py-4 bg-muted/30 flex gap-3 flex-shrink-0">
            <button
              onClick={handleDeny}
              className="flex-1 px-4 py-3 bg-secondary hover:bg-secondary/80 active:bg-secondary/70 text-secondary-foreground rounded-lg font-medium transition-colors"
            >
              Deny
            </button>
            <button
              onClick={handleAllow}
              disabled={(request.requiresCredential && !credential) || !promoteRuleValid}
              className="flex-1 px-4 py-3 bg-success hover:bg-success/80 active:bg-success/70 text-success-foreground rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {request.requiresCredential ? 'Allow with Credential' : 'Allow'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
