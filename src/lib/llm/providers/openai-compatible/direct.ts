import type { LLMRequest, LLMResponse } from "../../types";
import { safeReadText } from "../../shared/http";
import { extractFinishReason, extractTextChunk, extractToolCalls, extractUsage } from "../../shared/payload";
import { parseSSEStream } from "../../shared/stream";
import { resolveOpenAICompatibleUrl, buildOpenAIHeaders } from "./shared";

export async function sendToOpenAICompatible(input: LLMRequest): Promise<LLMResponse> {
  const shouldStream = input.stream ?? true;
  const response = await fetch(resolveOpenAICompatibleUrl(input.apiBaseUrl), {
    method: "POST",
    headers: buildOpenAIHeaders(input.apiKey),
    body: JSON.stringify(buildRequestBody(input, shouldStream)),
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
  const toolCalls = extractToolCalls(json, "openai-compatible");
  return {
    text: extractTextChunk(json, "openai-compatible"),
    usage: extractUsage(json, "openai-compatible"),
    toolCalls,
    finishReason: extractFinishReason(json, "openai-compatible"),
  };
}

function buildRequestBody(input: LLMRequest, shouldStream: boolean) {
  return {
    model: input.model,
    messages: input.messages.map((message) => {
      if (message.role === "tool") {
        return {
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId,
          name: message.name,
        };
      }

      if (message.role === "assistant" && message.toolCalls?.length) {
        return {
          role: "assistant",
          content: message.content || "",
          tool_calls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          })),
        };
      }

      return {
        role: message.role,
        content: message.content,
      };
    }),
    temperature: 0.4,
    stream: shouldStream,
    ...(input.tools?.length
      ? {
          tools: input.tools,
          tool_choice: input.toolChoice ?? "auto",
        }
      : {}),
  };
}
