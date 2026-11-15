import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { LLM_CONFIG } from "@/features/app/config/appData";
import { getErrorMessage, type StartChatgptLoginPayload } from "@/features/app/appHelpers";
import {
  beginChatgptLogin,
  getChatgptLoginStatus,
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
  settings: LLMSettings;
  setIsPanelModalOpen: Setter<boolean>;
  setIsSavingProvider: Setter<boolean>;
  setPanelModalError: Setter<string>;
  setSettings: Setter<LLMSettings>;
};

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

export function useProviderSettingsController({
  settings,
  setIsPanelModalOpen,
  setIsSavingProvider,
  setPanelModalError,
  setSettings,
}: ProviderSettingsControllerParams) {
  const [loginAttempt, setLoginAttempt] = useState<StartChatgptLoginPayload | null>(null);
  const [isChatGPTLoginBusy, setIsChatGPTLoginBusy] = useState(false);

  useEffect(() => {
    if (!loginAttempt) return;
    const { attemptId } = loginAttempt;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    // 브라우저를 다시 열어도 같은 로그인 시도는 한 번만 감시합니다.
    async function checkStatus() {
      try {
        const status = await getChatgptLoginStatus(attemptId);
        if (stopped) return;
        if (status === "pending") {
          timer = setTimeout(checkStatus, 1200);
          return;
        }
        const next = await getLlmSettings();
        if (stopped) return;
        setSettings(normalizeLlmSettings(next));
        setPanelModalError("");
        setLoginAttempt(null);
        void refreshAvailableProviderQueries().catch(() => {});
      } catch (error) {
        if (stopped) return;
        setPanelModalError(getErrorMessage(error));
        setLoginAttempt(null);
      }
    }
    void checkStatus();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [loginAttempt, setPanelModalError, setSettings]);

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
    setIsChatGPTLoginBusy(true);
    setPanelModalError("");
    try {
      if (loginAttempt && (await getChatgptLoginStatus(loginAttempt.attemptId)) === "succeeded") {
        return;
      }
      const auth = loginAttempt ?? (await beginChatgptLogin());
      setLoginAttempt(auth);
      await openExternalUrl(auth.authorizationUrl);
    } catch (error) {
      setPanelModalError(getErrorMessage(error));
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
      setLoginAttempt(null);
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
    isChatGPTLoginBusy,
    isChatGPTLoginPending: loginAttempt !== null,
    loadProviderSettings,
    loginChatGPT,
    logoutChatGPT,
    savePanelModalSettings,
  };
}
