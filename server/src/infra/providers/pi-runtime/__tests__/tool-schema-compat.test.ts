import { describe, expect, it } from 'vitest';

import {
  normalizeMoonshotJsonSchema,
  normalizeToolSchemasForModel,
  usesMoonshotToolSchemaFlavor,
  wrapStreamFnWithToolSchemaCompat,
} from '../tool-schema-compat.js';

const openAiModel = {
  id: 'gpt-5.2',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
} as any;

describe('Moonshot tool schema compatibility', () => {
  it('detects Moonshot and Kimi by provider, canonical API host, model id, or override', () => {
    expect(
      usesMoonshotToolSchemaFlavor({ provider: 'moonshotai-cn', baseUrl: 'https://x' } as any)
    ).toBe(true);
    expect(
      usesMoonshotToolSchemaFlavor({
        provider: 'openai',
        baseUrl: 'https://api.moonshot.cn/v1',
      } as any)
    ).toBe(true);
    expect(
      usesMoonshotToolSchemaFlavor({
        provider: 'openai',
        baseUrl: 'https://api.kimi.com/coding',
      } as any)
    ).toBe(true);
    expect(
      usesMoonshotToolSchemaFlavor({
        id: 'kimi-k3',
        provider: 'openai',
        baseUrl: 'http://192.168.2.150:3022/v1',
      })
    ).toBe(true);
    expect(
      usesMoonshotToolSchemaFlavor({
        id: 'private-model-alias',
        provider: 'openai',
        baseUrl: 'https://llm-gateway.example/v1',
        dialect: 'moonshotai',
      })
    ).toBe(true);
    expect(
      usesMoonshotToolSchemaFlavor({
        id: 'kimi-k3',
        provider: 'openai',
        baseUrl: 'https://api.moonshot.ai/v1',
        dialect: 'openai',
      })
    ).toBe(false);
    expect(usesMoonshotToolSchemaFlavor(openAiModel)).toBe(false);
  });

  it('drops an impossible root anyOf and normalizes nested branches without mutating the source', () => {
    const source = {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          anyOf: [{ minLength: 1 }, { pattern: '^x' }],
        },
      },
      anyOf: [{ required: ['path'] }, { type: 'object', required: ['file_path'] }],
    };

    expect(normalizeMoonshotJsonSchema(source)).toEqual({
      type: 'object',
      properties: {
        input: {
          anyOf: [
            { type: 'string', minLength: 1 },
            { type: 'string', pattern: '^x' },
          ],
        },
      },
    });
    expect(source.type).toBe('object');
    expect(source.anyOf[0]).toEqual({ required: ['path'] });
  });

  it('only rewrites outbound tools for Moonshot-flavored models', () => {
    const tool = {
      name: 'Read',
      label: 'Read',
      description: 'Read a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        anyOf: [{ required: ['path'] }, { required: ['file_path'] }],
      },
      execute: async () => ({ content: [], details: {} }),
    } as any;
    const tools = [tool];

    expect(normalizeToolSchemasForModel(tools, openAiModel)).toBe(tools);

    const normalized = normalizeToolSchemasForModel(tools, {
      provider: 'openai',
      baseUrl: 'https://api.moonshot.ai/v1',
    } as any);
    expect(normalized).not.toBe(tools);
    expect(normalized[0]).not.toBe(tool);
    expect(normalized[0].parameters).toMatchObject({
      type: 'object',
      properties: { path: { type: 'string' } },
    });
    expect((normalized[0].parameters as any).anyOf).toBeUndefined();
    expect(tool.parameters.type).toBe('object');
  });

  it('preserves properties declared only inside root anyOf branches', () => {
    expect(
      normalizeMoonshotJsonSchema({
        anyOf: [
          { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
        ],
      })
    ).toEqual({
      type: 'object',
      properties: { query: { type: 'string' }, id: { type: 'number' } },
    });
  });

  it('wrapStreamFnWithToolSchemaCompat normalizes outbound tools at the stream boundary', async () => {
    const seen: any[] = [];
    const base = ((model: any, context: any, options: any) => {
      seen.push({ model, context, options });
      return 'stream-result' as any;
    }) as any;
    const wrapped = wrapStreamFnWithToolSchemaCompat(base);

    const moonshotModel = { id: 'kimi-k3', provider: 'moonshotai', baseUrl: 'https://x' } as any;
    const tools = [
      {
        name: 'Read',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          anyOf: [{ required: ['path'] }, { required: ['file_path'] }],
        },
      },
    ];

    expect(wrapped(moonshotModel, { tools } as any, { opt: 1 } as any)).toBe('stream-result');
    expect((seen[0].context.tools[0].parameters as any).anyOf).toBeUndefined();
    expect(seen[0].options).toEqual({ opt: 1 });

    const noTools = { messages: [] } as any;
    wrapped(moonshotModel, noTools, undefined as any);
    expect(seen[1].context).toBe(noTools);

    wrapped(openAiModel, { tools } as any, undefined as any);
    expect(seen[2].context.tools).toBe(tools);
  });
});
