import type { Dispatch, SetStateAction } from "react";

import { LLM_CONFIG } from "@/features/app/config/appData";
import { resolveProviderApiUrl } from "@/config/loadModels";
import {
  beginChatgptLogin,
  getAvailableProviders,
  getLlmSettings,
  logoutChatgpt,
  openExternalUrl,
  saveLlmSettings,
  saveProviderSettings,
} from "@/features/backend/api";
import { AIQueryKeys } from "@/hooks/useAI";
import { queryClient } from "@/lib/queryClient";
import { normalizeLlmSettings, syncProviderCatalogWithModelsDev } from "@/features/ai/catalog";
import type { LLMSettings } from "@/types/chat";

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
  const saveProviderConfiguration = async (nextSettings: Pick<LLMSettings, "providerId" | "providerKind" | "baseUrl">) => {
    if (nextSettings.providerId === "openai") {
      const oauthUrl = resolveProviderApiUrl("openai", "oauth", nextSettings.baseUrl);
      const apiKeyUrl = resolveProviderApiUrl("openai", "api-key", nextSettings.baseUrl);

      await Promise.all([
        saveProviderSettings({
          providerId: "openai",
          providerKind: "oauth",
          apiUrl: oauthUrl,
        }),
        saveProviderSettings({
          providerId: "openai",
          providerKind: "api-key",
          apiUrl: apiKeyUrl,
        }),
      ]);
      return;
    }

    const apiUrl = resolveProviderApiUrl(
      nextSettings.providerId,
      nextSettings.providerKind,
      nextSettings.baseUrl
    );

    if (!apiUrl) {
      return;
    }

    await saveProviderSettings({
      providerId: nextSettings.providerId,
      providerKind: nextSettings.providerKind,
      apiUrl,
    });
  };

  const refreshAvailableProviderQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: AIQueryKeys.availableProviders });
    await queryClient.invalidateQueries({ queryKey: AIQueryKeys.availableModels });
  };

  const loadProviderSettings = async () => {
    try {
      const [next] = await Promise.all([getLlmSettings(), getAvailableProviders()]);
      setSettings(normalizeLlmSettings(next));
      await refreshAvailableProviderQueries();
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
      await saveProviderConfiguration(settings);
      const next = await saveLlmSettings({
        providerId: settings.providerId,
        providerKind: settings.providerKind,
        model: settings.model,
        apiKey: settings.apiKey,
        openaiOauthEnabled: settings.openaiOauthEnabled,
        openaiOauthPriority: settings.openaiOauthPriority,
        openaiApiKeyEnabled: settings.openaiApiKeyEnabled,
        openaiApiKeyPriority: settings.openaiApiKeyPriority,
      });
      setSettings(normalizeLlmSettings(next));
      await refreshAvailableProviderQueries();
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
      const auth = await beginChatgptLogin();
      setChatGPTLoginUrl(auth.authorizationUrl);
      await openExternalUrl(auth.authorizationUrl);
      setPanelModalError("");
      setIsChatGPTLoginBusy(false);

      const timeoutAt = Date.now() + 305_000;
      while (Date.now() < timeoutAt) {
        await new Promise((resolve) => {
          setTimeout(resolve, 1200);
        });

        const next = await getLlmSettings();
        setSettings(normalizeLlmSettings(next));
        if (next.loggedIn) {
          await saveProviderConfiguration({
            providerId: next.providerId,
            providerKind: next.providerKind,
            baseUrl: next.baseUrl,
          });
          await refreshAvailableProviderQueries();
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
      const next = await logoutChatgpt();
      setSettings(normalizeLlmSettings(next));
      await refreshAvailableProviderQueries();
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
