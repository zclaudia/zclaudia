import type { OpenAI } from 'openai';
import { LLMClient } from '@browserbasehq/stagehand';

/**
 * Custom OpenAI client that handles model responses wrapping JSON in markdown.
 * Solves the ```json ... ``` fencing that MiniMax/GLM-class models emit.
 */
export class CleanJsonOpenAIClient extends LLMClient {
  type = 'openai' as const;
  private client: OpenAI;
  private modelName: string;

  constructor({ modelName, client }: { modelName: string; client: OpenAI }) {
    super();
    this.modelName = modelName;
    this.client = client;
  }

  /**
   * Strip markdown code fences.
   * Input: ```json\n{...}\n```
   * Output: {...}
   */
  private cleanMarkdownJson(content: string): string {
    // Strip markdown code fences.
    let cleaned = content.trim();

    // Match ```json ... ``` or bare ``` ... ```
    const codeBlockRegex = /^```(?:json)?\s*([\s\S]*?)\s*```$/;
    const match = cleaned.match(codeBlockRegex);

    if (match) {
      cleaned = match[1].trim();
    }

    // Trim stray whitespace.
    return cleaned.trim();
  }

  async createChatCompletion(options: any): Promise<any> {
    const {
      options: { messages, temperature, top_p, frequency_penalty, presence_penalty },
    } = options;

    // Harden the system prompt to demand JSON output.
    const enhancedMessages = messages.map((msg: any, index: number) => {
      if (index === 0 && msg.role === 'system') {
        // Append an explicit JSON-format requirement to the system prompt.
        return {
          role: msg.role,
          content: `${msg.content}

CRITICAL: You MUST respond with a valid JSON object. Do not wrap the JSON in markdown code blocks. Do not add any text before or after the JSON. Your entire response should be parseable by JSON.parse().

Required JSON format:
{
  "elementId": "string (required)",
  "description": "string (required)",
  "method": "string (required)",
  "arguments": "array (required, can be empty [])",
  "twoStep": "boolean (required)"
}`,
        };
      }
      return {
        role: msg.role,
        content: msg.content,
      };
    });

    // Build the request parameters.
    const requestOptions: any = {
      model: this.modelName,
      messages: enhancedMessages,
      // Force a higher temperature for more stable output;
      // 0.1 makes some models unstable or return empty content.
      temperature: Math.max(temperature ?? 0.7, 0.7),
      top_p: top_p ?? 1,
      frequency_penalty: frequency_penalty ?? 0,
      presence_penalty: presence_penalty ?? 0,
    };

    // Try without response_format so models respond more naturally;
    // response_format makes some models return empty objects.
    // try {
    //   requestOptions.response_format = { type: "json_object" };
    // } catch (e) {
    //   console.warn("[CleanJsonOpenAIClient] response_format not supported, continuing...");
    // }

    // Reduced logging (production mode).
    if (process.env.DEBUG_AI === 'true') {
      console.log('[CleanJsonOpenAIClient] Model:', this.modelName);
      console.log('[CleanJsonOpenAIClient] Messages:', messages.length);
      console.log('[CleanJsonOpenAIClient] Temperature:', requestOptions.temperature);
    }

    // Call the OpenAI API.
    const response = await this.client.chat.completions.create(requestOptions);

    // Read the raw content.
    const rawContent = response.choices[0]?.message?.content || '';

    // Strip markdown fences.
    const cleanedContent = this.cleanMarkdownJson(rawContent);

    // Attempt to parse JSON.
    let parsedContent;
    try {
      parsedContent = JSON.parse(cleanedContent);
    } catch (e) {
      if (process.env.DEBUG_AI === 'true') {
        console.warn('[CleanJsonOpenAIClient] JSON parse failed:', e);
        console.warn('[CleanJsonOpenAIClient] Content:', cleanedContent);
      }
      parsedContent = {};
    }

    // Stagehand expects a { data, usage } shape.
    const result = {
      data: parsedContent,
      usage: {
        prompt_tokens: response.usage?.prompt_tokens || 0,
        completion_tokens: response.usage?.completion_tokens || 0,
        reasoning_tokens: (response.usage?.completion_tokens_details as any)?.reasoning_tokens || 0,
        cached_input_tokens: (response.usage?.prompt_tokens_details as any)?.cached_tokens || 0,
      },
    };

    return result as any;
  }
}
