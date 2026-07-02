import { describe, it, expect } from 'vitest';
import {
  BUILTIN_WORKFLOW_TEMPLATES,
  AI_AUTO_COMMIT_TEMPLATE_ID,
  SYSTEM_AI_AUTO_COMMIT_KEY,
} from '../templates.js';

describe('AI auto-commit template', () => {
  const t = () => BUILTIN_WORKFLOW_TEMPLATES.find(x => x.id === AI_AUTO_COMMIT_TEMPLATE_ID);

  it('exports stable ids', () => {
    expect(AI_AUTO_COMMIT_TEMPLATE_ID).toBe('ai-auto-commit');
    expect(SYSTEM_AI_AUTO_COMMIT_KEY).toBe('ai_auto_commit');
  });

  it('is a trigger-free 4-node stage→check→generate→commit graph', () => {
    const tpl = t()!;
    expect(tpl).toBeDefined();
    expect('triggers' in tpl.definition).toBe(false);
    const types = tpl.definition.nodes.map(n => n.type);
    expect(types).toEqual(['git_stage', 'condition', 'generate_commit_message', 'git_commit']);
    expect(tpl.definition.entryNodeId).toBe('stage');
  });

  it('guards on staged changes and feeds the generated message into the commit', () => {
    const tpl = t()!;
    const check = tpl.definition.nodes.find(n => n.id === 'check')!;
    expect(check.condition?.expression).toBe('${stage.output.hasChanges} == true');
    const commit = tpl.definition.nodes.find(n => n.id === 'commit')!;
    expect(commit.config).toMatchObject({
      stageAll: false,
      messageMode: 'explicit',
      message: '${generate.output.message}',
    });
    const edges = tpl.definition.edges;
    expect(
      edges.some(
        e => e.source === 'check' && e.target === 'generate' && e.type === 'condition_true'
      )
    ).toBe(true);
    expect(edges.some(e => e.type === 'condition_false')).toBe(false);
  });
});
