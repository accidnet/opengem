import { getProviderCatalog, type ProviderProtocol } from "@/features/ai/catalog";
import { sendToAnthropic } from "@/features/ai/providers/anthropic/direct";
import { sendToGemini } from "@/features/ai/providers/google/direct";
import { sendToOpenAIOAuth, sendToOpenAICompatible } from "@/features/ai/providers/openai/direct";

import type { LLMRequest, LLMResponse } from "../../lib/llm/types";

type LLMTransport =
  | "chatgpt-oauth-direct"
  | "anthropic-direct"
  | "google-gemini-direct"
  | "openai-compatible-direct";

function resolveDirectTransport(input: LLMRequest, protocol: ProviderProtocol): LLMTransport {
  if (protocol === "chatgpt-responses" || input.providerKind === "oauth") {
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

export async function request(input: LLMRequest): Promise<LLMResponse> {
  const provider = getProviderCatalog(input.providerId);
  const transport = resolveDirectTransport(input, provider.protocol);

  switch (transport) {
    case "chatgpt-oauth-direct":
      return sendToOpenAIOAuth(input);
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
