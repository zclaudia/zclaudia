/**
 * AIRunnerPort implementation using the virtual client pattern.
 *
 * Bridges the domain port to the server infrastructure (createVirtualClient, handleRunStart).
 */

import type { Database } from 'better-sqlite3';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { AIRunnerPort } from '../ports/step-executor.js';
import type { WorkflowAiRunPort } from '../ports/runtime.js';
import { SessionRepository } from '../../sessions/repository.js';

export class VirtualClientAIRunner implements AIRunnerPort {
  private sessionRepo: SessionRepository;
  private aiRunPort: WorkflowAiRunPort;

  constructor(
    private db: Database,
    aiRunPort?: WorkflowAiRunPort
  ) {
    this.sessionRepo = new SessionRepository(db);
    this.aiRunPort = aiRunPort ?? {
      startVirtualRun: () => {
        throw new Error('Workflow AI run port not configured');
      },
    };
  }

  async runPrompt(opts: {
    projectId?: string;
    llmProfileId?: string;
    prompt: string;
    workingDirectory?: string;
    sessionName?: string;
    sessionId?: string;
    timeoutMs?: number;
    onSessionCreated?: (sessionId: string) => void;
  }): Promise<{ sessionId: string; content: string }> {
    if (!opts.sessionId && !opts.projectId) {
      throw new Error('VirtualClientAIRunner.runPrompt: projectId is required');
    }
    // opts.llmProfileId used downstream for AI dispatch; agentProfileId auto-resolved by SessionRepository.
    const sessionId =
      opts.sessionId ??
      this.sessionRepo.create({
        projectId: opts.projectId!,
        name: opts.sessionName ?? 'Workflow AI',
        type: 'background',
        projectRole: 'workflow',
        workingDirectory: opts.workingDirectory,
      }).id;

    if (!opts.sessionId) {
      opts.onSessionCreated?.(sessionId);
    }

    const before = this.db
      .prepare('SELECT COALESCE(MAX(rowid), 0) AS rowid FROM messages WHERE session_id = ?')
      .get(sessionId) as { rowid: number } | undefined;
    const beforeRowid = before?.rowid ?? 0;

    const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
    const clientId = `workflow_ai_${sessionId}_${Date.now()}`;

    return new Promise<{ sessionId: string; content: string }>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`AI prompt timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.aiRunPort.startVirtualRun({
        clientId,
        sessionId,
        input: opts.prompt,
        workingDirectory: opts.workingDirectory,
        llmProfileId: opts.llmProfileId,
        onMessage: (msg: ServerMessage) => {
          if (settled) return;
          if (msg.type === 'run_completed') {
            settled = true;
            clearTimeout(timeout);
            const messages = this.db
              .prepare(
                "SELECT content FROM messages WHERE session_id = ? AND role = 'assistant' AND rowid > ? ORDER BY rowid ASC"
              )
              .all(sessionId, beforeRowid) as { content: string }[];
            const content = messages.map(m => m.content).join('\n');
            resolve({ sessionId, content });
          } else if (msg.type === 'run_failed') {
            settled = true;
            clearTimeout(timeout);
            const error =
              (msg as import('@zclaudia/shared/wire/messages').RunFailedMessage).error ??
              'AI prompt failed';
            reject(new Error(error));
          }
        },
      });
    });
  }
}
