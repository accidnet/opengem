import type { LLMRequest, LLMResponse } from "../../types";
import { safeReadText } from "../../shared/http";
import { extractTextChunk, extractUsage } from "../../shared/payload";
import { parseSSEStream } from "../../shared/stream";
import { resolveOpenAICompatibleUrl, buildOpenAIHeaders } from "./shared";

export async function sendToOpenAICompatible(input: LLMRequest): Promise<LLMResponse> {
  const shouldStream = input.stream ?? true;
  const response = await fetch(resolveOpenAICompatibleUrl(input.apiBaseUrl), {
    method: "POST",
    headers: buildOpenAIHeaders(input.apiKey),
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      temperature: 0.4,
      stream: shouldStream,
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(`LLM API error (${response.status}): ${detail || response.statusText}`);
  }

  if (!response.body) {
    throw new Error("LLM response body is missing.");
  }

  if (shouldStream) {
    return parseSSEStream(response, "openai-compatible", input.onChunk, input.onEvent);
  }

  const json = (await response.json()) as Record<string, unknown>;
  return {
    text: extractTextChunk(json, "openai-compatible"),
    usage: extractUsage(json, "openai-compatible"),
  };
}
