import { invoke } from "@tauri-apps/api/core";

import type { StartChatgptLoginPayload } from "@/features/app/appHelpers";
import type { CharacterItem, LLMSettings, ResolvedLLMSettings, SessionDetail } from "@/types/chat";

import type { AIModel, AvailableProviderInfo, ProviderInfo } from "@/features/ai/types";

export type SaveLlmSettingsParams = {
  providerId: LLMSettings["providerId"];
  providerKind: LLMSettings["providerKind"];
  apiUrl?: string;
  model: string;
  apiKey?: string;
  openaiOauthEnabled: boolean;
  openaiOauthPriority: number;
  openaiApiKeyEnabled: boolean;
  openaiApiKeyPriority: number;
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

type ProviderCredentialType = "oauth" | "api-key";

type GetProviderCredentialParams = {
  providerId: string;
  credentialType: ProviderCredentialType;
};

export type ProviderCredentialValue =
  | {
      providerId: string;
      credentialType: "oauth";
      accessToken?: string;
      accountId?: string;
    }
  | {
      providerId: string;
      credentialType: "api-key";
      baseUrl?: string | null;
      apiKey?: string;
    };

export async function getLlmSettings(): Promise<LLMSettings> {
  return invoke<LLMSettings>("get_llm_settings");
}

export async function getAvailableProviders(): Promise<AvailableProviderInfo[]> {
  return invoke<AvailableProviderInfo[]>("get_available_providers");
}

export function listProviderModels(input: GetProviderCredentialParams): Promise<AIModel[]> {
  return invoke("list_provider_models", { input });
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
  input: SaveProviderSettingsParams
): Promise<ProviderSettings> {
  return invoke<ProviderSettings>("save_provider_settings_command", { input });
}

export async function getProviderCredential(
  input: GetProviderCredentialParams
): Promise<ProviderCredentialValue> {
  return invoke<ProviderCredentialValue>("get_provider_credential", { input });
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

export async function listCharacters(): Promise<CharacterItem[]> {
  return invoke<CharacterItem[]>("list_characters");
}

export async function saveCharacter(input: {
  id?: string;
  name: string;
  image: string;
}): Promise<CharacterItem> {
  return invoke<CharacterItem>("save_character", { input });
}

export async function deleteCharacter(id: string): Promise<void> {
  return invoke("delete_character", { id });
}
