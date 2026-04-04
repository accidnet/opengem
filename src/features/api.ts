import { invoke } from "@tauri-apps/api/core";

import type { StartChatgptLoginPayload } from "@/features/app/appHelpers";
import type { LLMSettings } from "@/types/chat";

export type AvailableProviderInfo = {
  providerId: string;
  credentialTypes: string[];
  hasApiKey: boolean;
  loggedIn: boolean;
};

export type SaveLlmSettingsParams = {
  providerId: LLMSettings["providerId"];
  providerKind: LLMSettings["providerKind"];
  model: string;
  apiKey?: string;
};

export async function getLlmSettings(): Promise<LLMSettings> {
  return invoke<LLMSettings>("get_llm_settings");
}

export async function getAvailableProviders(): Promise<AvailableProviderInfo[]> {
  return invoke<AvailableProviderInfo[]>("get_available_providers");
}

export async function saveLlmSettings(input: SaveLlmSettingsParams): Promise<LLMSettings> {
  return invoke<LLMSettings>("save_llm_settings", { input });
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
