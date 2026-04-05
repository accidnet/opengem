import { getProviderCatalog, type ProviderProtocol } from "@/features/ai/catalog";
import { sendToAnthropic } from "@/features/ai/providers/anthropic/direct";
import { sendToGemini } from "@/features/ai/providers/google/direct";
import { sendToOpenAIOAuth, sendToOpenAICompatible } from "@/features/ai/providers/openai/direct";

import type { AIRequest, AIResponse } from "./types/common";

type LLMTransport =
  | "chatgpt-oauth-direct"
  | "anthropic-direct"
  | "google-gemini-direct"
  | "openai-compatible-direct";

function resolveDirectTransport(input: AIRequest, protocol: ProviderProtocol): LLMTransport {
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

// TODO: 요청을 위해서는 protocol을 입력받고, 그거에 맞춰서 provider의 호출 함수를 부를 수 있도록 할 것.
export async function request(input: AIRequest): Promise<AIResponse> {
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
      return sendToOpenAIOAuth(input);
    default:
      return sendToOpenAIOAuth(input);
  }
}
