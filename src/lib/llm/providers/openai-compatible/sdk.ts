import { sendWithVercelAiSdk, type VercelAiSdkTarget } from "../../shared/sdk";
import type { LLMRequest, LLMResponse } from "../../types";

export async function sendWithOpenAICompatibleSdk(
  input: LLMRequest,
  sdkTarget: VercelAiSdkTarget
): Promise<LLMResponse> {
  return sendWithVercelAiSdk(input, sdkTarget);
}
