import type { AIRequest, AIResponse } from "@/features/ai/types/common";
import {
  extractFinishReason,
  extractTextChunk,
  extractToolCalls,
  extractUsage,
} from "@/features/ai/payload";
import { parseSSEStream } from "@/features/ai/stream";
import { normalizeBaseUrl } from "@/lib/utils";

function buildHeaders(authorization?: string, accountId?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authorization) {
    headers.Authorization = `Bearer ${authorization}`;
  }

  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }

  return headers;
}

function buildMessages(input: AIRequest) {
  return input.messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: [{ type: "output_text", text: message.content }],
      };
    }

    return {
      role: message.role,
      content: [{ type: "input_text", text: message.content }],
    };
  });
}

function buildRequestBody(input: AIRequest) {
  const firstMessage = input.messages[0];
  const hasSystemPrompt = firstMessage?.role === "system";
  return {
    model: input.model,
    instructions: hasSystemPrompt ? firstMessage.content : "You are a helpful assistant.",
    input: buildMessages(input),
    stream: input.stream,
    store: false,
    temperature: input.temperature,
    ...(input.tools?.length
      ? {
          tools: input.tools,
          tool_choice: input.toolChoice ?? "auto",
        }
      : {}),
  };
}

async function send(input: AIRequest): Promise<Response> {
  const response = await fetch(`${normalizeBaseUrl(input.apiBaseUrl)}/responses`, {
    method: "POST",
    headers: buildHeaders(input.apiKey, undefined),
    body: JSON.stringify(buildRequestBody(input)),
    signal: input.signal,
  });
  return response;
}

export async function sendToOpenAICompatible(input: AIRequest): Promise<AIResponse> {
  const response = await send(input);

  if (!response.ok) {
    throw new Error(`${input.apiBaseUrl} error (${response.status}): ${response.text()}`);
  }

  if (!response.body) {
    throw new Error(`${input.apiBaseUrl} body is missing.`);
  }

  if (input.stream) {
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

export async function sendToOpenAIOAuth(input: AIRequest): Promise<AIResponse> {
  const response = await send(input);

  if (!response.ok) {
    const detail = response.text();
    throw new Error(`ChatGPT API error (${response.status}): ${detail || response.statusText}`);
  }

  if (!response.body) {
    throw new Error("ChatGPT response body is missing.");
  }

  if (input.stream ?? true) {
    return parseSSEStream(response, "chatgpt-responses", input.onChunk, input.onEvent);
  }

  return parseSSEStream(response, "chatgpt-responses");
}
