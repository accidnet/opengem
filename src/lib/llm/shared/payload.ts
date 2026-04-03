import type { ProviderProtocol } from "@/data/llmCatalog";

import type { GoogleUsage, JsonRecord, LLMToolCall, LLMUsage, OpenAIUsage } from "../types";

type ToolCallDelta = {
  index: number;
  id?: string;
  name?: string;
  argumentsChunk?: string;
};

export function extractTextChunk(payload: JsonRecord, protocol: ProviderProtocol): string {
  if (protocol === "anthropic") {
    const delta = readPath(payload, ["delta", "text"]);
    if (typeof delta === "string") {
      return delta;
    }

    const anthropicContent = readPath(payload, ["content"]);
    if (Array.isArray(anthropicContent)) {
      return anthropicContent
        .map((item) => (item && typeof item === "object" ? (item as JsonRecord).text : ""))
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join("");
    }
  }

  if (protocol === "google-gemini") {
    const parts = readPath(payload, ["candidates", 0, "content", "parts"]);
    if (Array.isArray(parts)) {
      return parts
        .map((part) => (part && typeof part === "object" ? (part as JsonRecord).text : ""))
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join("");
    }
  }

  const openAIChunk = readPath(payload, ["choices", 0, "delta", "content"]);
  if (typeof openAIChunk === "string" && openAIChunk.length > 0) {
    return openAIChunk;
  }

  const openAIMessage = readPath(payload, ["choices", 0, "message", "content"]);
  if (typeof openAIMessage === "string" && openAIMessage.length > 0) {
    return openAIMessage;
  }

  const directDelta = payload.delta;
  if (typeof directDelta === "string" && directDelta.length > 0) {
    return directDelta;
  }

  const directText = payload.text;
  if (typeof directText === "string" && directText.length > 0) {
    return directText;
  }

  const outputText = payload.output_text;
  if (typeof outputText === "string" && outputText.length > 0) {
    return outputText;
  }

  const nestedOutputText = readPath(payload, ["response", "output_text"]);
  if (typeof nestedOutputText === "string" && nestedOutputText.length > 0) {
    return nestedOutputText;
  }

  return "";
}

export function extractUsage(payload: JsonRecord, protocol: ProviderProtocol): LLMUsage | undefined {
  if (protocol === "google-gemini") {
    const usage = payload.usageMetadata as GoogleUsage | undefined;
    if (!usage) {
      return undefined;
    }

    return {
      promptTokens: usage.promptTokenCount,
      completionTokens: usage.candidatesTokenCount,
      totalTokens: usage.totalTokenCount,
    };
  }

  const usage = payload.usage as OpenAIUsage | JsonRecord | undefined;
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  if ("input_tokens" in usage || "output_tokens" in usage || "total_tokens" in usage) {
    return {
      promptTokens: readNumber(usage, "input_tokens"),
      completionTokens: readNumber(usage, "output_tokens"),
      totalTokens: readNumber(usage, "total_tokens"),
    };
  }

  return {
    promptTokens: readNumber(usage, "prompt_tokens"),
    completionTokens: readNumber(usage, "completion_tokens"),
    totalTokens: readNumber(usage, "total_tokens"),
  };
}

export function extractFinishReason(payload: JsonRecord, protocol: ProviderProtocol): string | undefined {
  if (protocol === "anthropic") {
    const stopReason = readPath(payload, ["stop_reason"]);
    if (typeof stopReason === "string" && stopReason.length > 0) {
      return stopReason;
    }
  }

  if (protocol === "google-gemini") {
    const finishReason = readPath(payload, ["candidates", 0, "finishReason"]);
    if (typeof finishReason === "string" && finishReason.length > 0) {
      return finishReason;
    }
  }

  const openAIFinishReason = readPath(payload, ["choices", 0, "finish_reason"]);
  if (typeof openAIFinishReason === "string" && openAIFinishReason.length > 0) {
    return openAIFinishReason;
  }

  const directFinishReason = payload.finish_reason;
  if (typeof directFinishReason === "string" && directFinishReason.length > 0) {
    return directFinishReason;
  }

  const responseStatus = readPath(payload, ["response", "status"]);
  if (typeof responseStatus === "string" && responseStatus.length > 0) {
    return responseStatus;
  }

  return undefined;
}

export function extractToolCalls(payload: JsonRecord, protocol: ProviderProtocol): LLMToolCall[] | undefined {
  if (protocol !== "openai-compatible" && protocol !== "chatgpt-responses") {
    return undefined;
  }

  const messageToolCalls = readPath(payload, ["choices", 0, "message", "tool_calls"]);
  if (Array.isArray(messageToolCalls)) {
    return messageToolCalls
      .map((entry) => mapResolvedToolCall(entry))
      .filter((entry): entry is LLMToolCall => Boolean(entry));
  }

  return undefined;
}

export function extractToolCallDeltas(
  payload: JsonRecord,
  protocol: ProviderProtocol
): ToolCallDelta[] | undefined {
  if (protocol !== "openai-compatible" && protocol !== "chatgpt-responses") {
    return undefined;
  }

  const toolCalls = readPath(payload, ["choices", 0, "delta", "tool_calls"]);
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return undefined;
  }

  return toolCalls
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as JsonRecord;
      const fn = record.function && typeof record.function === "object" ? (record.function as JsonRecord) : null;
      return {
        index: typeof record.index === "number" ? record.index : index,
        id: typeof record.id === "string" ? record.id : undefined,
        name: typeof fn?.name === "string" ? fn.name : undefined,
        argumentsChunk: typeof fn?.arguments === "string" ? fn.arguments : undefined,
      } satisfies ToolCallDelta;
    })
    .filter((entry): entry is ToolCallDelta => Boolean(entry));
}

function mapResolvedToolCall(entry: unknown): LLMToolCall | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as JsonRecord;
  const fn = record.function && typeof record.function === "object" ? (record.function as JsonRecord) : null;
  const id = typeof record.id === "string" ? record.id : "";
  const name = typeof fn?.name === "string" ? fn.name : "";
  const args = typeof fn?.arguments === "string" ? fn.arguments : "{}";

  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    arguments: args,
  };
}

function readNumber(value: JsonRecord, key: string): number | undefined {
  const result = value[key];
  return typeof result === "number" ? result : undefined;
}

function readPath(value: unknown, path: Array<string | number>): unknown {
  let current = value;

  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[key];
      continue;
    }

    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = (current as JsonRecord)[key];
  }

  return current;
}
