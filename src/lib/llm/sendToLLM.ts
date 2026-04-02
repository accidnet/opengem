import { getProviderCatalog, type ProviderProtocol } from "@/data/llmCatalog";

import type { LLMRequest, LLMResponse } from "./types";
import { sendToAnthropic } from "./providers/anthropic/direct";
import { sendToChatGptOAuth } from "./providers/chatgpt-responses/direct";
import { sendToGemini } from "./providers/google-gemini/direct";
import { sendToOpenAICompatible } from "./providers/openai-compatible/direct";
import { sendWithOpenAICompatibleSdk } from "./providers/openai-compatible/sdk";

export async function sendToLLM(input: LLMRequest): Promise<LLMResponse> {
  const provider = getProviderCatalog(input.providerId);
  const protocol = provider.protocol;
  const sdkTarget = provider.sdkTarget;

  if (canUseVercelAiSdk(protocol, sdkTarget)) {
    try {
      return await sendWithOpenAICompatibleSdk(input, sdkTarget);
    } catch (error) {
      console.warn("[opengem] AI SDK path failed, falling back to direct fetch transport.", error);
    }
  }

  if (protocol === "chatgpt-responses" || input.providerKind === "chatgpt_oauth") {
    return sendToChatGptOAuth(input);
  }

  if (protocol === "anthropic") {
    return sendToAnthropic(input);
  }

  if (protocol === "google-gemini") {
    return sendToGemini(input);
  }

  return sendToOpenAICompatible(input);
}

function canUseVercelAiSdk(
  protocol: ProviderProtocol,
  sdkTarget?: "openai" | "openai-compatible" | "native-fetch"
): sdkTarget is "openai" | "openai-compatible" {
  return protocol === "openai-compatible" && Boolean(sdkTarget) && sdkTarget !== "native-fetch";
}
