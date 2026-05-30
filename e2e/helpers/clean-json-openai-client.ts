import { OpenAI } from "openai";
import { LLMClient } from "@browserbasehq/stagehand";
import * as fs from "fs";
import * as path from "path";

/**
 * 自定义 OpenAI Client，处理模型返回 markdown 包裹的 JSON
 * 解决 MiniMax、GLM 等模型返回 ```json ... ``` 格式的问题
 */
export class CleanJsonOpenAIClient extends LLMClient {
  type = "openai" as const;
  private client: OpenAI;
  private modelName: string;

  constructor({ modelName, client }: { modelName: string; client: OpenAI }) {
    super();
    this.modelName = modelName;
    this.client = client;
  }

  /**
   * 清理 markdown 代码块标记
   * 输入: ```json\n{...}\n```
   * 输出: {...}
   */
  private cleanMarkdownJson(content: string): string {
    // 移除 markdown 代码块标记
    let cleaned = content.trim();

    // 匹配 ```json ... ``` 或 ``` ... ```
    const codeBlockRegex = /^```(?:json)?\s*([\s\S]*?)\s*```$/;
    const match = cleaned.match(codeBlockRegex);

    if (match) {
      cleaned = match[1].trim();
    }

    // 移除前后的额外空白
    return cleaned.trim();
  }

  async createChatCompletion(options: any): Promise<any> {
    const {
      options: { messages, temperature, top_p, frequency_penalty, presence_penalty, image },
      response_model,
    } = options;

    // 增强 system prompt，明确要求 JSON 格式
    const enhancedMessages = messages.map((msg: any, index: number) => {
      if (index === 0 && msg.role === "system") {
        // 在系统提示中添加明确的 JSON 格式要求
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

    // 构建请求参数
    const requestOptions: any = {
      model: this.modelName,
      messages: enhancedMessages,
      // 强制使用更高的 temperature，让模型输出更稳定
      // 0.1 太低会导致模型输出不稳定或返回空值
      temperature: Math.max(temperature ?? 0.7, 0.7),
      top_p: top_p ?? 1,
      frequency_penalty: frequency_penalty ?? 0,
      presence_penalty: presence_penalty ?? 0,
    };

    // 尝试不使用 response_format，让模型更自然地返回
    // response_format 可能导致某些模型返回空对象
    // try {
    //   requestOptions.response_format = { type: "json_object" };
    // } catch (e) {
    //   console.warn("[CleanJsonOpenAIClient] response_format not supported, continuing...");
    // }

    // 简化日志输出（生产模式）
    if (process.env.DEBUG_AI === "true") {
      console.log("[CleanJsonOpenAIClient] Model:", this.modelName);
      console.log("[CleanJsonOpenAIClient] Messages:", messages.length);
      console.log("[CleanJsonOpenAIClient] Temperature:", requestOptions.temperature);
    }

    // 调用 OpenAI API
    const response = await this.client.chat.completions.create(requestOptions);

    // 获取原始内容
    const rawContent = response.choices[0]?.message?.content || "";

    // 清理 markdown 代码块
    const cleanedContent = this.cleanMarkdownJson(rawContent);

    // 尝试解析 JSON
    let parsedContent;
    try {
      parsedContent = JSON.parse(cleanedContent);
    } catch (e) {
      if (process.env.DEBUG_AI === "true") {
        console.warn("[CleanJsonOpenAIClient] JSON parse failed:", e);
        console.warn("[CleanJsonOpenAIClient] Content:", cleanedContent);
      }
      parsedContent = {};
    }

    // Stagehand 期望返回 { data, usage } 格式
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
