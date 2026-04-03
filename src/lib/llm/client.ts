import { getProviderCatalog, type ProviderProtocol } from "@/data/llmCatalog";

import type { LLMRequest, LLMResponse } from "./types";
import { sendToAnthropic } from "./providers/anthropic/direct";
import { sendToChatGptOAuth } from "./providers/openai-compatible/chatgpt";
import { sendToGemini } from "./providers/google/direct";
import { sendToOpenAICompatible } from "./providers/openai-compatible/direct";
import { sendWithVercelAiSdk } from "./sdk";

type LLMTransport =
  | "vercel-ai-sdk"
  | "chatgpt-oauth-direct"
  | "anthropic-direct"
  | "google-gemini-direct"
  | "openai-compatible-direct";

function resolveDirectTransport(input: LLMRequest, protocol: ProviderProtocol): LLMTransport {
  if (protocol === "chatgpt-responses" || input.providerKind === "chatgpt_oauth") {
    return "chatgpt-oauth-direct";
  }

  if (protocol === "anthropic") {
    return "anthropic-direct";
  }

  if (protocol === "google-gemini") {
    return "google-gemini-direct";
  }

  return "openai-compatible-direct";
}

function sendWithDirectTransport(input: LLMRequest, transport: LLMTransport): Promise<LLMResponse> {
  switch (transport) {
    case "chatgpt-oauth-direct":
      return sendToChatGptOAuth(input);
    case "anthropic-direct":
      return sendToAnthropic(input);
    case "google-gemini-direct":
      return sendToGemini(input);
    case "openai-compatible-direct":
      return sendToOpenAICompatible(input);
    default:
      return sendToOpenAICompatible(input);
  }
}

export async function request(input: LLMRequest): Promise<LLMResponse> {
  const provider = getProviderCatalog(input.providerId);
  const fallbackTransport = resolveDirectTransport(input, provider.protocol);

  try {
    return await sendWithVercelAiSdk(input, provider.sdkTarget);
  } catch (error) {
    console.warn("Vercel AI SDK path failed, falling back to direct fetch transport.", error);
    return sendWithDirectTransport(input, fallbackTransport);
  }
}
