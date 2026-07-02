import { useState, useEffect, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import * as api from '../../../services/api';
import type { SimulateAIReviewResponse } from '../../../services/api/debug';
import type { LlmProfileConfig } from '@zclaudia/shared';
import { Select } from '../../../components/ui/Select';
import { SettingsRow } from '../ui/SettingsGroup';

export function AiReviewSimulatorSection() {
  const [expanded, setExpanded] = useState(false);

  // AI Review Simulator state (verbatim from original lines 36–45)
  const [simToolName, setSimToolName] = useState('Bash');
  const [simDetail, setSimDetail] = useState('');
  const [simCwd, setSimCwd] = useState('');
  const [simProviderId, setSimProviderId] = useState('');
  const [simThreshold, setSimThreshold] = useState(0.8);
  const [simMode, setSimMode] = useState<'quick' | 'full' | 'runtime' | 'workflow'>('quick');
  const [simRunning, setSimRunning] = useState(false);
  const [simResult, setSimResult] = useState<SimulateAIReviewResponse | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [simProviders, setSimProviders] = useState<LlmProfileConfig[]>([]);

  // handleRunSimulation callback (verbatim from original lines 158–178)
  const handleRunSimulation = useCallback(async () => {
    setSimRunning(true);
    setSimError(null);
    setSimResult(null);
    try {
      const result = await api.simulateAIReview({
        toolName: simToolName,
        toolInput: simToolName === 'Bash' ? { command: simDetail } : { content: simDetail },
        detail: simDetail,
        cwd: simCwd,
        llmProfileId: simProviderId || undefined,
        confidenceThreshold: simThreshold,
        mode: simMode,
      });
      setSimResult(result);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setSimRunning(false);
    }
  }, [simToolName, simDetail, simCwd, simProviderId, simThreshold, simMode]);

  // Load providers for AI Review Simulator (verbatim from original lines 258–270)
  useEffect(() => {
    api
      .listLlmProfiles()
      .then(providers => {
        const list = providers ?? [];
        setSimProviders(list);
        if (list.length > 0 && !simProviderId) {
          setSimProviderId(list[0].id);
        }
      })
      .catch(() => {
        /* ignore */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SettingsRow
      align="start"
      title="AI review simulator"
      description="Test how AI review evaluates different commands with your configured providers."
      control={
        <button
          onClick={() => setExpanded(v => !v)}
          aria-label={expanded ? 'Collapse AI review simulator' : 'Expand AI review simulator'}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      }
    >
      {expanded && (
        <div className="space-y-3">
          {/* Form (verbatim from original lines 546–617) */}
          <div className="space-y-2">
            {/* Row 1: Tool + Command */}
            <div className="flex gap-2">
              <Select
                value={simToolName}
                onChange={setSimToolName}
                size="md"
                triggerClassName="w-20 shrink-0"
                options={[
                  { value: 'Bash', label: 'Bash' },
                  { value: 'Write', label: 'Write' },
                  { value: 'Edit', label: 'Edit' },
                  { value: 'Read', label: 'Read' },
                ]}
              />
              <input
                type="text"
                value={simDetail}
                onChange={e => setSimDetail(e.target.value)}
                placeholder={
                  simToolName === 'Bash'
                    ? 'Command (e.g. rm -rf /tmp/test)'
                    : 'File path or content'
                }
                className="flex-1 min-w-0 px-2 py-1 text-xs bg-background border border-border rounded-lg"
              />
            </div>

            {/* Row 2: Working directory */}
            <input
              type="text"
              value={simCwd}
              onChange={e => setSimCwd(e.target.value)}
              placeholder="Working directory (cwd)"
              className="w-full px-2 py-1 text-xs bg-background border border-border rounded-lg"
            />

            {/* Row 3: Provider + Threshold + Mode in a grid */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
              <Select
                value={simProviderId}
                onChange={setSimProviderId}
                size="md"
                block
                options={
                  simProviders.length === 0
                    ? [{ value: '', label: 'No providers' }]
                    : simProviders.map(p => ({
                        value: p.id,
                        label: `${p.name} (${p.providerType})`,
                      }))
                }
              />

              <input
                type="number"
                value={simThreshold}
                onChange={e => setSimThreshold(parseFloat(e.target.value) || 0.8)}
                min={0}
                max={1}
                step={0.1}
                title="Confidence threshold"
                className="w-14 px-1 py-1 text-xs bg-background border border-border rounded-full text-center"
              />

              <Select<'quick' | 'full' | 'runtime' | 'workflow'>
                value={simMode}
                onChange={setSimMode}
                size="md"
                title="Evaluation mode"
                options={[
                  { value: 'quick', label: 'Quick — single-pass, no rate limit' },
                  { value: 'full', label: 'Full — multi-turn with file reading' },
                  { value: 'runtime', label: 'Runtime — oneshot task runtime' },
                  { value: 'workflow', label: 'Workflow — full permission pipeline' },
                ]}
              />
            </div>
          </div>

          {/* Run Review button (verbatim from original lines 619–625) */}
          <button
            onClick={() => {
              void handleRunSimulation();
            }}
            disabled={simRunning || !simDetail.trim() || simProviders.length === 0}
            className="w-full py-1.5 text-xs bg-muted/60 hover:bg-muted disabled:bg-muted disabled:text-muted-foreground text-foreground rounded-lg font-medium transition-colors"
          >
            {simRunning ? 'Running Review…' : 'Run Review'}
          </button>

          {/* simError block (verbatim from original lines 627–629) */}
          {simError && <div className="text-xs text-destructive">{simError}</div>}

          {/* pending-pi-agent block (verbatim from original lines 631–635) */}
          {simResult && simResult.pendingPiAgent && (
            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-xs text-blue-700 dark:text-blue-300">
              AI Review is waiting for the pi-agent runtime to be wired up. Once pi-agent is
              integrated, the simulator will dispatch the real zclaudia runtime and return review
              results.
            </div>
          )}

          {/* Result viewer (verbatim from original lines 637–754, with bg-background/70 rounded-lg → bg-secondary/40 rounded-md) */}
          {simResult && !simResult.pendingPiAgent && (
            <div className="p-3 bg-secondary/40 rounded-md space-y-2">
              {/* Decision header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-1.5 py-0.5 text-[11px] font-medium rounded-md ${
                      simResult.decision === 'approve'
                        ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                        : simResult.decision === 'deny'
                          ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                          : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                    }`}
                  >
                    {simResult.decision.toUpperCase()}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {Math.round(simResult.confidence * 100)}% confidence
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {simResult.durationMs}ms · {simResult.providerType} · {simResult.mode}
                </span>
              </div>

              {/* Confidence bar */}
              <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    simResult.confidence >= 0.8
                      ? 'bg-green-500'
                      : simResult.confidence >= 0.5
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                  }`}
                  style={{ width: `${simResult.confidence * 100}%` }}
                />
              </div>

              {/* Reasoning */}
              <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
                {simResult.reasoning}
              </div>

              {/* Workflow steps (only for workflow mode) */}
              {simResult.steps && simResult.steps.length > 0 && (
                <div className="space-y-1.5 pt-1 border-t border-border/50">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    Workflow Steps
                    {simResult.workflowStatus && (
                      <span
                        className={`ml-1.5 px-1 py-0.5 rounded-md text-[10px] ${
                          simResult.workflowStatus === 'completed'
                            ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                            : 'bg-red-500/15 text-red-600 dark:text-red-400'
                        }`}
                      >
                        {simResult.workflowStatus}
                      </span>
                    )}
                    {simResult.workflowDecision && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        → {simResult.workflowDecision}
                      </span>
                    )}
                  </div>
                  {simResult.steps.map((step, i) => {
                    const stepOutput = step.output as Record<string, unknown> | null;
                    return (
                      <div key={i} className="flex items-start gap-2 text-[11px]">
                        <span
                          className={`shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full ${
                            step.status === 'completed'
                              ? 'bg-green-500'
                              : step.status === 'failed'
                                ? 'bg-red-500'
                                : step.status === 'running'
                                  ? 'bg-blue-500'
                                  : 'bg-muted-foreground/40'
                          }`}
                        />
                        <span className="font-mono text-foreground/80 shrink-0">{step.nodeId}</span>
                        <span className="text-muted-foreground/60">{step.status}</span>
                        {stepOutput?.decision != null && (
                          <span
                            className={`px-1 rounded-md text-[10px] ${
                              String(stepOutput.decision) === 'approve'
                                ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                                : String(stepOutput.decision) === 'deny'
                                  ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                                  : 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400'
                            }`}
                          >
                            {String(stepOutput.decision)}
                          </span>
                        )}
                        {stepOutput?.confidence != null && (
                          <span className="text-muted-foreground/50">
                            {Math.round(Number(stepOutput.confidence) * 100)}%
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Telemetry (runtime mode) */}
              {simResult.telemetry && Object.keys(simResult.telemetry).length > 0 && (
                <div className="pt-1 border-t border-border/50">
                  <div className="text-[11px] font-medium text-muted-foreground mb-1">
                    Runtime Telemetry
                  </div>
                  <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                    {Object.entries(simResult.telemetry).map(([k, v]) => (
                      <span key={k}>
                        <span className="text-foreground/60">{k}:</span> {String(v)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Metadata */}
              {simResult.metadata && Object.keys(simResult.metadata).length > 0 && (
                <div className="pt-1 border-t border-border/50">
                  <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                    {Object.entries(simResult.metadata).map(([k, v]) => (
                      <span key={k}>
                        <span className="text-foreground/60">{k}:</span> {String(v)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </SettingsRow>
  );
}
