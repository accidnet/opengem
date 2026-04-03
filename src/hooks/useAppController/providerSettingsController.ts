import { invoke } from "@tauri-apps/api/core";
import type { Dispatch, SetStateAction } from "react";

import { LLM_CONFIG } from "@/features/app/config/appData";
import { normalizeLlmSettings, syncProviderCatalogWithModelsDev } from "@/lib/llm/catalog";
import type { LLMSettings } from "@/types/chat";

import type { StartChatgptLoginPayload } from "@/features/app/appHelpers";

type Setter<T> = Dispatch<SetStateAction<T>>;

type ProviderSettingsControllerParams = {
  chatGPTLoginUrl: string;
  settings: LLMSettings;
  setChatGPTLoginUrl: Setter<string>;
  setIsChatGPTLoginBusy: Setter<boolean>;
  setIsPanelModalOpen: Setter<boolean>;
  setIsSavingProvider: Setter<boolean>;
  setPanelModalError: Setter<string>;
  setSettings: Setter<LLMSettings>;
};

async function openExternalUrl(url: string): Promise<void> {
  await invoke("open_external_url", { url });
}

export function createProviderSettingsController({
  chatGPTLoginUrl,
  settings,
  setChatGPTLoginUrl,
  setIsChatGPTLoginBusy,
  setIsPanelModalOpen,
  setIsSavingProvider,
  setPanelModalError,
  setSettings,
}: ProviderSettingsControllerParams) {
  const loadProviderSettings = async () => {
    try {
      const next = await invoke<LLMSettings>("get_llm_settings");
      setSettings(normalizeLlmSettings(next));
      const changed = syncProviderCatalogWithModelsDev();
      if (changed) {
        setSettings((current) => normalizeLlmSettings({ ...current }));
      }
      setPanelModalError("");
    } catch {
      setSettings(normalizeLlmSettings(LLM_CONFIG));
    }
  };

  const savePanelModalSettings = async () => {
    setIsSavingProvider(true);
    try {
      const next = await invoke<LLMSettings>("save_llm_settings", { input: settings });
      setSettings(normalizeLlmSettings(next));
      setPanelModalError("");
      setIsPanelModalOpen(false);
    } catch (error) {
      setPanelModalError(error instanceof Error ? error.message : "Provider 설정을 저장하지 못했습니다.");
    } finally {
      setIsSavingProvider(false);
    }
  };

  const loginChatGPT = async () => {
    if (chatGPTLoginUrl) {
      await openExternalUrl(chatGPTLoginUrl);
      return;
    }

    setIsChatGPTLoginBusy(true);
    try {
      const auth = await invoke<StartChatgptLoginPayload>("begin_chatgpt_login");
      setChatGPTLoginUrl(auth.authorizationUrl);
      await openExternalUrl(auth.authorizationUrl);
      setPanelModalError("");
      setIsChatGPTLoginBusy(false);

      const timeoutAt = Date.now() + 305_000;
      while (Date.now() < timeoutAt) {
        await new Promise((resolve) => {
          setTimeout(resolve, 1200);
        });

        const next = await invoke<LLMSettings>("get_llm_settings");
        setSettings(normalizeLlmSettings(next));
        if (next.chatgptLoggedIn) {
          setChatGPTLoginUrl("");
          return;
        }
      }

      setPanelModalError(
        "로그인 시간이 초과됐습니다. 브라우저에서 인증을 완료했는지 확인한 뒤 다시 시도해 주세요."
      );
    } catch (error) {
      setPanelModalError(
        error instanceof Error ? error.message : `ChatGPT 로그인에 실패했습니다: ${String(error)}`
      );
    } finally {
      setIsChatGPTLoginBusy(false);
    }
  };

  const logoutChatGPT = async () => {
    setIsChatGPTLoginBusy(true);
    try {
      const next = await invoke<LLMSettings>("logout_chatgpt");
      setSettings(normalizeLlmSettings(next));
      setChatGPTLoginUrl("");
      setPanelModalError("");
    } catch (error) {
      setPanelModalError(error instanceof Error ? error.message : "ChatGPT 로그아웃에 실패했습니다.");
    } finally {
      setIsChatGPTLoginBusy(false);
    }
  };

  return {
    loadProviderSettings,
    loginChatGPT,
    logoutChatGPT,
    savePanelModalSettings,
  };
}
