import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toolRegistry } from '../../../plugins/index.js';
import { registerInteractionTools } from '../interaction-tools.js';

describe('registered interaction tools', () => {
  beforeEach(() => {
    toolRegistry.removeBySource('interaction');
  });

  afterEach(() => {
    toolRegistry.removeBySource('interaction');
  });

  it('advertises cancelled as a valid update_todo_list status', () => {
    registerInteractionTools();

    const tool = toolRegistry.get('update_todo_list');
    const parameters = tool?.definition.function.parameters as any;
    const statuses = parameters.properties.todos.items.properties.status.enum;

    expect(statuses).toContain('cancelled');
  });
});
