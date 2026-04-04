import { normalizeBaseUrl } from "@/lib/utils";

import type { LLMRequest, LLMResponse } from "@/lib/llm/types";
import { splitSystemMessages } from "@/features/ai/messages";
import { extractFinishReason, extractTextChunk, extractUsage } from "@/features/ai/payload";
import { parseSSEStream } from "@/features/ai/stream";

export async function sendToGemini(input: LLMRequest): Promise<LLMResponse> {
  const shouldStream = input.stream ?? true;
  const { system, messages } = splitSystemMessages(input.messages);
  const apiKey = input.apiKey?.trim();
  if (!apiKey) {
    throw new Error("Gemini API key is missing.");
  }

  const response = await fetch(
    resolveGeminiUrl(input.apiBaseUrl, input.model, apiKey, shouldStream),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: system
          ? {
              parts: [{ text: system }],
            }
          : undefined,
        contents: messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          temperature: 0.4,
        },
      }),
      signal: input.signal,
    }
  );

  if (!response.ok) {
    const detail = response.text();
    throw new Error(`Gemini API error (${response.status}): ${detail || response.statusText}`);
  }

  if (!response.body) {
    throw new Error("Gemini response body is missing.");
  }

  if (shouldStream) {
    return parseSSEStream(response, "google-gemini", input.onChunk, input.onEvent);
  }

  const json = (await response.json()) as Record<string, unknown>;
  return {
    text: extractTextChunk(json, "google-gemini"),
    usage: extractUsage(json, "google-gemini"),
    finishReason: extractFinishReason(json, "google-gemini"),
  };
}

function resolveGeminiUrl(baseUrl: string, model: string, apiKey: string, stream: boolean): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const operation = stream ? "streamGenerateContent?alt=sse" : "generateContent";
  return `${normalizedBaseUrl}/models/${model}:${operation}&key=${apiKey}`.replace(
    ":generateContent&",
    ":generateContent?"
  );
}
