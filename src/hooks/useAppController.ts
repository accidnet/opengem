import { useEffect, useState, type SetStateAction } from "react";

import { LLM_CONFIG } from "@/features/app/config/appData";
import { normalizeLlmSettings } from "@/features/ai/catalog";
import type { LLMSettings, ThemeMode } from "../types/chat";
import { createProviderSettingsController } from "./providerSettingsController";

export function useAppController() {
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [settings, setSettings] = useState<LLMSettings>(LLM_CONFIG);
  const [isPanelModalOpen, setIsPanelModalOpen] = useState(false);
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [isChatGPTLoginBusy, setIsChatGPTLoginBusy] = useState(false);
  const [chatGPTLoginUrl, setChatGPTLoginUrl] = useState("");
  const [panelModalError, setPanelModalError] = useState("");

  const { loadProviderSettings, loginChatGPT, logoutChatGPT, savePanelModalSettings } =
    createProviderSettingsController({
      chatGPTLoginUrl,
      settings,
      setChatGPTLoginUrl,
      setIsChatGPTLoginBusy,
      setIsPanelModalOpen,
      setIsSavingProvider,
      setPanelModalError,
      setSettings,
    });

  useEffect(() => {
    void loadProviderSettings();
    // 컨트롤러 팩토리가 매 렌더마다 함수를 생성하므로 초기 로드만 실행합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return {
    chatGPTLoginUrl,
    isChatGPTLoginBusy,
    isPanelModalOpen,
    isSavingProvider,
    loginChatGPT,
    logoutChatGPT,
    panelModalError,
    savePanelModalSettings,
    setIsPanelModalOpen,
    setPanelModalError,
    setSettings: (next: SetStateAction<LLMSettings>) => {
      if (typeof next === "function") {
        setSettings((prev) => normalizeLlmSettings((next as (prev: LLMSettings) => LLMSettings)(prev)));
        return;
      }
      setSettings(normalizeLlmSettings(next));
    },
    settings,
    theme,
    toggleTheme,
  };
}
