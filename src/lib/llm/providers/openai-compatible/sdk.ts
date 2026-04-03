import { generateText, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { normalizeBaseUrl } from "@/data/llmCatalog";

import { DEFAULT_API_BASE_URL } from "../../constants";
import type { LLMRequest, LLMResponse, LLMUsage } from "../../types";

export async function sendWithOpenAICompatibleSdk(
  input: LLMRequest,
  sdkTarget: "openai" | "openai-compatible"
): Promise<LLMResponse> {
  const model = createSdkLanguageModel(input, sdkTarget);
  const messages = input.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  if (input.stream ?? true) {
    const result = streamText({
      model,
      messages,
      abortSignal: input.signal,
    });

    let text = "";
    input.onEvent?.({ event: "sdk-start", data: input.model });

    for await (const chunk of result.textStream) {
      text += chunk;
      input.onChunk?.(chunk);
      input.onEvent?.({ event: "sdk-chunk", data: chunk });
    }

    input.onEvent?.({ event: "sdk-finish", data: input.model });

    return {
      text,
      usage: mapSdkUsage(await Promise.resolve(result.usage as unknown).catch(() => undefined)),
      finishReason: "stop",
    };
  }

  const result = await generateText({
    model,
    messages,
    abortSignal: input.signal,
  });

  return {
    text: result.text,
    usage: mapSdkUsage(result.usage),
    finishReason: "stop",
  };
}

function createSdkLanguageModel(
  input: LLMRequest,
  sdkTarget: "openai" | "openai-compatible"
) {
  const baseURL = normalizeBaseUrl(input.apiBaseUrl || DEFAULT_API_BASE_URL);

  if (sdkTarget === "openai") {
    const openai = createOpenAI({
      apiKey: input.apiKey,
      baseURL,
    });
    return openai.chat(input.model);
  }

  const provider = createOpenAICompatible({
    name: input.providerId || "custom-openai-compatible",
    apiKey: input.apiKey,
    baseURL,
  });

  return provider.chatModel(input.model);
}

function mapSdkUsage(
  usage:
    | {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      }
    | undefined
): LLMUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}
