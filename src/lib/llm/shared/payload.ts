import type { ProviderProtocol } from "@/data/llmCatalog";

import type { GoogleUsage, JsonRecord, LLMUsage, OpenAIUsage } from "../types";

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
