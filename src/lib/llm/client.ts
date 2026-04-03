import { getProviderCatalog, type ProviderProtocol } from "@/data/llmCatalog";

import type { LLMRequest, LLMResponse } from "./types";
import { sendToAnthropic } from "./providers/anthropic/direct";
import { sendToChatGptOAuth } from "./providers/openai-compatible/chatgpt";
import { sendToGemini } from "./providers/google/direct";
import { sendToOpenAICompatible } from "./providers/openai-compatible/direct";
import { sendWithOpenAICompatibleSdk } from "./providers/openai-compatible/sdk";

type LLMTransport =
  | "vercel-ai-sdk"
  | "chatgpt-oauth-direct"
  | "anthropic-direct"
  | "google-gemini-direct"
  | "openai-compatible-direct";

function resolvePreferredTransport(
  input: LLMRequest,
  protocol: ProviderProtocol,
  sdkTarget: "openai" | "openai-compatible" | "native-fetch" | undefined
): LLMTransport {
  const customTransport = resolveCustomTransport(input, protocol, sdkTarget);
  if (customTransport) {
    return customTransport;
  }

  if (canUseVercelAiSdk(protocol, sdkTarget, input)) {
    return "vercel-ai-sdk";
  }

  return resolveDirectTransport(input, protocol);
}

function resolveCustomTransport(
  _input: LLMRequest,
  _protocol: ProviderProtocol,
  _sdkTarget: "openai" | "openai-compatible" | "native-fetch" | undefined
): LLMTransport | null {
  return null;
}

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

function canUseVercelAiSdk(
  protocol: ProviderProtocol,
  sdkTarget: "openai" | "openai-compatible" | "native-fetch" | undefined,
  input?: LLMRequest
): sdkTarget is "openai" | "openai-compatible" {
  return (
    protocol === "openai-compatible" &&
    Boolean(sdkTarget) &&
    sdkTarget !== "native-fetch" &&
    !input?.tools?.length &&
    !input?.messages.some((message) => message.role === "tool" || message.role === "developer")
  );
}

export async function request(input: LLMRequest): Promise<LLMResponse> {
  const provider = getProviderCatalog(input.providerId);
  const preferredTransport = resolvePreferredTransport(
    input,
    provider.protocol,
    provider.sdkTarget
  );
  const fallbackTransport = resolveDirectTransport(input, provider.protocol);

  if (preferredTransport === "vercel-ai-sdk") {
    try {
      return await sendWithOpenAICompatibleSdk(input, provider.sdkTarget);
    } catch (error) {
      console.warn("[opengem] AI SDK path failed, falling back to direct fetch transport.", error);
    }
  }

  return sendWithDirectTransport(input, fallbackTransport);
}
