import type { Dispatch, SetStateAction } from "react";

import { LLM_CONFIG } from "@/features/app/config/appData";
import {
  beginChatgptLogin,
  getLlmSettings,
  logoutChatgpt,
  openExternalUrl,
  saveLlmSettings,
} from "@/features/backend/api";
import { AIQueryKeys, preloadAvailableModels } from "@/hooks/useAI";
import { queryClient } from "@/lib/queryClient";
import { normalizeLlmSettings } from "@/features/ai/catalog";
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
  const refreshAvailableProviderQueries = async () => {
    // 같은 공급자의 키만 교체한 경우에도 이전 계정에서 진행 중인 조회를 폐기합니다.
    await queryClient.cancelQueries({ queryKey: AIQueryKeys.availableModels });
    await queryClient.invalidateQueries({
      queryKey: AIQueryKeys.availableModels,
      refetchType: "none",
    });
    await queryClient.invalidateQueries({ queryKey: AIQueryKeys.availableProviders });
    void preloadAvailableModels().catch(() => {});
  };

  const loadProviderSettings = async () => {
    try {
      const next = await getLlmSettings();
      setSettings(normalizeLlmSettings(next));
      void preloadAvailableModels().catch(() => {});
      setPanelModalError("");
    } catch {
      setSettings(normalizeLlmSettings(LLM_CONFIG));
    }
  };

  const savePanelModalSettings = async () => {
    setIsSavingProvider(true);
    try {
      const next = await saveLlmSettings({
        providerId: settings.providerId,
        providerKind: settings.providerKind,
        apiUrl: settings.providerId === "custom" ? settings.baseUrl.trim() : undefined,
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
      setPanelModalError(
        error instanceof Error ? error.message : "Provider 설정을 저장하지 못했습니다."
      );
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
      setPanelModalError(
        error instanceof Error ? error.message : "ChatGPT 로그아웃에 실패했습니다."
      );
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
