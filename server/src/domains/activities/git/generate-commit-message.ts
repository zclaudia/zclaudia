import type { Activity, ActivityResult, ActivityServices } from '../types.js';
import { getStagedDiff } from '../../../utils/git-operations.js';

export interface GenerateCommitMessageInput {
  worktreePath?: string;
  projectRootPath?: string;
}

export interface GenerateCommitMessageOutput extends Record<string, unknown> {
  subject: string;
  body?: string;
  message: string;
}

const SYSTEM_PROMPT = `You write git commit messages in the Conventional Commits format.
Given a staged diff, produce a single commit message.
Rules:
- Subject: "type(scope): summary" — type is one of feat, fix, docs, style, refactor, perf, test, build, ci, chore. Scope is optional.
- Imperative mood, lower-case summary, no trailing period, at most 72 characters.
- Include a body only when it adds information the subject cannot convey; otherwise omit it.
- Write in English.
Return JSON: { "subject": string, "body"?: string }.`;

export class GenerateCommitMessageActivity
  implements Activity<GenerateCommitMessageInput, GenerateCommitMessageOutput>
{
  readonly type = 'generate_commit_message';

  async invoke(
    input: GenerateCommitMessageInput,
    services: ActivityServices,
  ): Promise<ActivityResult<GenerateCommitMessageOutput>> {
    const repoPath = input.worktreePath ?? input.projectRootPath;
    if (!repoPath) {
      return { status: 'failed', output: { subject: '', message: '' }, error: 'No working directory' };
    }

    const staged = await getStagedDiff(repoPath);
    if (staged.files.length === 0) {
      return { status: 'failed', output: { subject: '', message: '' }, error: 'No staged changes' };
    }

    const userInput = [
      '# Staged files',
      staged.files.join('\n'),
      '',
      '# Stat',
      staged.stat,
      '',
      `# Diff${staged.truncated ? ' (truncated)' : ''}`,
      staged.diff,
    ].join('\n');

    const result = await services.agentLoopRunner.run({
      owner: { type: 'manual', id: `git-commit-message:${repoPath}` },
      purpose: 'git.commit_message',
      ...(services.llmProfileId ? { llmProfileId: services.llmProfileId } : {}),
      cwd: repoPath,
      systemPrompt: SYSTEM_PROMPT,
      input: userInput,
      toolset: { id: 'none' },
      outputContract: {
        type: 'json',
        schema: {
          type: 'object',
          required: ['subject'],
          additionalProperties: false,
          properties: {
            subject: { type: 'string' },
            body: { type: 'string' },
          },
        },
        repairAttempts: 1,
      },
      context: { policy: 'none' },
      limits: { maxTurns: 1, timeoutMs: 30_000 },
      permissionMode: 'deny-external',
    });

    if (result.status !== 'completed') {
      return {
        status: 'failed',
        output: { subject: '', message: '' },
        error: result.error ?? `Generation failed: ${result.status}`,
      };
    }

    const subject = String(result.output.subject ?? '').trim();
    const body = typeof result.output.body === 'string' ? result.output.body.trim() : '';
    if (!subject) {
      return { status: 'failed', output: { subject: '', message: '' }, error: 'Model returned an empty subject' };
    }
    const message = body ? `${subject}\n\n${body}` : subject;
    return { status: 'completed', output: { subject, ...(body ? { body } : {}), message } };
  }
}
