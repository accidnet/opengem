import { invoke } from "@tauri-apps/api/core";

import type { StartChatgptLoginPayload } from "@/features/app/appHelpers";
import type { LLMSettings, ResolvedLLMSettings, SessionDetail } from "@/types/chat";

import type { AvailableProviderInfo, ProviderInfo } from "@/features/ai/types";

export type SaveLlmSettingsParams = {
  providerId: LLMSettings["providerId"];
  providerKind: LLMSettings["providerKind"];
  model: string;
  apiKey?: string;
};

type ProviderSettings = {
  id: number;
  providerId: string;
  providerKind: LLMSettings["providerKind"];
  name?: string;
  apiUrl: string;
};

type SaveProviderSettingsParams = {
  providerId: string;
  providerKind: LLMSettings["providerKind"];
  name?: string;
  apiUrl: string;
};

export async function getLlmSettings(): Promise<LLMSettings> {
  return invoke<LLMSettings>("get_llm_settings");
}

export async function getAvailableProviders(): Promise<AvailableProviderInfo[]> {
  return invoke<AvailableProviderInfo[]>("get_available_providers");
}

export async function getProviders(): Promise<ProviderInfo[]> {
  return invoke<ProviderInfo[]>("get_providers");
}

export async function getChatSession(sessionId: string): Promise<SessionDetail> {
  return invoke<SessionDetail>("get_chat_session", { sessionId });
}

export async function resolveLlmSettings(): Promise<ResolvedLLMSettings> {
  return invoke<ResolvedLLMSettings>("resolve_llm_settings");
}

export async function saveLlmSettings(input: SaveLlmSettingsParams): Promise<LLMSettings> {
  return invoke<LLMSettings>("save_llm_settings", { input });
}

export async function saveProviderSettings(
  input: SaveProviderSettingsParams,
): Promise<ProviderSettings> {
  return invoke<ProviderSettings>("save_provider_settings_command", { input });
}

export async function beginChatgptLogin(): Promise<StartChatgptLoginPayload> {
  return invoke<StartChatgptLoginPayload>("begin_chatgpt_login");
}

export async function logoutChatgpt(): Promise<LLMSettings> {
  return invoke<LLMSettings>("logout_chatgpt");
}

export async function openExternalUrl(url: string): Promise<void> {
  await invoke("open_external_url", { url });
}
