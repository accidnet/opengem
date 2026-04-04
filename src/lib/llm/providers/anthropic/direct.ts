import { normalizeBaseUrl } from "@/lib/utils";

import type { LLMRequest, LLMResponse } from "@/lib/llm/types";
import { splitSystemMessages } from "@/lib/llm/messages";
import { extractFinishReason, extractTextChunk, extractUsage } from "@/lib/llm/payload";
import { parseSSEStream } from "@/lib/llm/stream";

export async function sendToAnthropic(input: LLMRequest): Promise<LLMResponse> {
  const shouldStream = input.stream ?? true;
  const { system, messages } = splitSystemMessages(input.messages);
  const response = await fetch(resolveAnthropicUrl(input.apiBaseUrl), {
    method: "POST",
    headers: buildAnthropicHeaders(input.apiKey),
    body: JSON.stringify({
      model: input.model,
      system,
      messages: messages.map((message) => ({
        role: message.role,
        content: [{ type: "text", text: message.content }],
      })),
      max_tokens: 4096,
      temperature: 0.4,
      stream: shouldStream,
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${detail || response.statusText}`);
  }

  if (!response.body) {
    throw new Error("Anthropic response body is missing.");
  }

  if (shouldStream) {
    return parseSSEStream(response, "anthropic", input.onChunk, input.onEvent);
  }

  const json = (await response.json()) as Record<string, unknown>;
  return {
    text: extractTextChunk(json, "anthropic"),
    usage: extractUsage(json, "anthropic"),
    finishReason: extractFinishReason(json, "anthropic"),
  };
}

function resolveAnthropicUrl(baseUrl: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return `${normalizedBaseUrl}/messages`;
}

function buildAnthropicHeaders(apiKey?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };

  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  return headers;
}
