import type { ToolName } from '@zclaudia/shared/core/tools';

export type EditToolSelectionEvalAssertion =
  | {
      kind: 'prompt';
      terms: string[];
    }
  | {
      kind: 'core-tools';
      tools: ToolName[];
    }
  | {
      kind: 'schema';
      tool: ToolName;
      required?: string[];
      properties: string[];
    }
  | {
      kind: 'metadata';
      tool: ToolName;
      declaredReadOnly: boolean;
      mutatesWorkspace: boolean;
    }
  | {
      kind: 'loop-recovery';
      tool: ToolName;
      args: Record<string, unknown>;
      details: Record<string, unknown>;
      attempts: number;
      nextTool?: ToolName;
      terms: string[];
    };

export interface EditToolSelectionEvalFixture {
  id: string;
  task: string;
  expectedPrimaryTools: ToolName[];
  avoidTools?: ToolName[];
  assertions: EditToolSelectionEvalAssertion[];
}

export const EDIT_TOOL_SELECTION_EVAL_FIXTURES: readonly EditToolSelectionEvalFixture[] = [
  {
    id: 'same-file-batch-replacements',
    task: [
      'In src/routes.ts, replace three route labels and two matching handler names.',
      'All replacements are exact string changes in the same file.',
    ].join(' '),
    expectedPrimaryTools: ['MultiEdit'],
    avoidTools: ['Write'],
    assertions: [
      { kind: 'core-tools', tools: ['Read', 'MultiEdit'] },
      {
        kind: 'prompt',
        terms: ['Use MultiEdit', 'two or more exact replacements', 'edits array', 'atomically'],
      },
      {
        kind: 'schema',
        tool: 'MultiEdit',
        required: ['file_path', 'edits'],
        properties: ['file_path', 'edits', 'preview_only'],
      },
      { kind: 'metadata', tool: 'MultiEdit', declaredReadOnly: false, mutatesWorkspace: true },
    ],
  },
  {
    id: 'single-supported-symbol-change',
    task: [
      'In src/scheduler.ts, update the _schedule_chat method body only.',
      'Do not rewrite nearby helpers or the rest of the file.',
    ].join(' '),
    expectedPrimaryTools: ['ReadSymbol', 'EditSymbol'],
    assertions: [
      { kind: 'core-tools', tools: ['ReadSymbol', 'EditSymbol'] },
      {
        kind: 'prompt',
        terms: [
          'ReadSymbol before EditSymbol',
          'function, method, class, or exported variable',
          'expected_body_digest',
        ],
      },
      {
        kind: 'schema',
        tool: 'ReadSymbol',
        required: ['symbol'],
        properties: ['file_path', 'path', 'symbol'],
      },
      {
        kind: 'schema',
        tool: 'EditSymbol',
        required: ['symbol', 'new_body'],
        properties: [
          'file_path',
          'path',
          'symbol',
          'new_body',
          'expected_body_digest',
          'preview_only',
        ],
      },
      { kind: 'metadata', tool: 'ReadSymbol', declaredReadOnly: true, mutatesWorkspace: false },
      { kind: 'metadata', tool: 'EditSymbol', declaredReadOnly: false, mutatesWorkspace: true },
      {
        kind: 'loop-recovery',
        tool: 'EditSymbol',
        args: { file_path: 'src/scheduler.ts', symbol: '_schedule_chat' },
        details: { ok: false, error: 'stale_symbol' },
        attempts: 3,
        nextTool: 'ReadSymbol',
        terms: ['bodyDigest', 'expected_body_digest', 'Retry EditSymbol'],
      },
    ],
  },
  {
    id: 'line-anchor-drift',
    task: [
      'A previous line-number edit missed after lines were inserted above the target.',
      'Refresh anchors and replace the current target line.',
    ].join(' '),
    expectedPrimaryTools: ['Read', 'Edit'],
    assertions: [
      { kind: 'core-tools', tools: ['Read', 'Edit'] },
      {
        kind: 'prompt',
        terms: ['hashline:true', 'hashline_operation', 'line-level anchors may have drifted'],
      },
      {
        kind: 'schema',
        tool: 'Read',
        properties: ['path', 'hashline'],
      },
      {
        kind: 'schema',
        tool: 'Edit',
        properties: ['file_path', 'hashline_operation', 'hashline_tag'],
      },
      {
        kind: 'loop-recovery',
        tool: 'Edit',
        args: { file_path: 'src/app.ts', hashline_operation: 'replace:oldhash' },
        details: { ok: false, error: 'hashline_mismatch' },
        attempts: 3,
        nextTool: 'Read',
        terms: ['hashline:true', 'fresh anchors', 'hashline_operation'],
      },
    ],
  },
  {
    id: 'structural-full-file-rewrite',
    task: [
      'Rewrite a generated Markdown table and a JSON-like structured section where many rows will move.',
      'Exact small replacements are likely to cascade.',
    ].join(' '),
    expectedPrimaryTools: ['Write'],
    avoidTools: ['MultiEdit'],
    assertions: [
      { kind: 'core-tools', tools: ['Read', 'Write'] },
      {
        kind: 'prompt',
        terms: [
          'Use Write',
          'full-file rewrites',
          'JSON arrays',
          'Markdown tables',
          'YAML',
          'TOML',
        ],
      },
      {
        kind: 'schema',
        tool: 'Write',
        required: ['file_path', 'content'],
        properties: ['file_path', 'content'],
      },
      { kind: 'metadata', tool: 'Write', declaredReadOnly: false, mutatesWorkspace: true },
    ],
  },
  {
    id: 'successful-edit-no-reverify-read',
    task: [
      'After Edit succeeds and returns a diff, continue to the next requested change.',
      'Do not call Read only to verify the already-reported diff.',
    ].join(' '),
    expectedPrimaryTools: ['Edit'],
    avoidTools: ['Read'],
    assertions: [
      { kind: 'core-tools', tools: ['Edit'] },
      {
        kind: 'prompt',
        terms: [
          'After a successful Write, Edit, MultiEdit, or EditSymbol result',
          'rely on its diff',
          'do not call Read again only to verify',
        ],
      },
      { kind: 'metadata', tool: 'Edit', declaredReadOnly: false, mutatesWorkspace: true },
    ],
  },
];
