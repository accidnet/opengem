import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  AGENTS,
  DEFAULT_MODE_ICONS,
  INITIAL_ACTIVITY,
  LLM_CONFIG,
  MODES,
  SESSION_MESSAGES,
  type Mode,
  type ModeIcon,
} from "@/features/app/config/appData";
import { normalizeLlmSettings } from "@/lib/llm/catalog";
import { buildSessionTitle } from "@/utils/chat";
import type {
  ActivityItem,
  AgentItem,
  LLMSettings,
  Message,
  ResolvedLLMSettings,
  SessionItem,
} from "@/types/chat";
import { normalizeAgentsForUi } from "@/features/app/appHelpers";
import { createSessionModeController } from "@/hooks/useAppController/sessionModeController";
import { useChatSendMessage } from "./useChatSendMessage";

type UseChatControllerParams = {
  settings: LLMSettings;
};

export function useChatController({ settings }: UseChatControllerParams) {
  const [messages, setMessages] = useState<Message[]>(SESSION_MESSAGES);
  const [sessionsByMode, setSessionsByMode] = useState<Record<Mode, SessionItem[]>>({});
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSessionTitle, setCurrentSessionTitle] = useState("새 채팅");
  const [currentSessionProjectPaths, setCurrentSessionProjectPaths] = useState<string[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>(INITIAL_ACTIVITY);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [modes, setModes] = useState<Mode[]>([...MODES]);
  const [selectedMode, setSelectedMode] = useState<Mode>(MODES[0]);
  const [modeIcons, setModeIcons] = useState<Record<Mode, ModeIcon>>({ ...DEFAULT_MODE_ICONS });
  const [modeProjectPaths, setModeProjectPaths] = useState<Record<Mode, string[]>>({});
  const [modeDefaultModels, setModeDefaultModels] = useState<Record<Mode, string>>({});
  const [resourceToken, setResourceToken] = useState(2405);
  const [resourceCost, setResourceCost] = useState(0.04);
  const [agents, setAgents] = useState<AgentItem[]>(normalizeAgentsForUi([...AGENTS]));
  const [openSelectedModeSignal, setOpenSelectedModeSignal] = useState(0);

  const resetCurrentSession = () => {
    setMessages(SESSION_MESSAGES);
    setCurrentSessionId(null);
    setCurrentSessionTitle("새 채팅");
    setCurrentSessionProjectPaths([]);
    setInputValue("");
  };

  const {
    getModeDefaultModel,
    getModeIcon,
    getModeProjectPaths,
    handleSessionDelete,
    handleSessionSelect,
    loadOperationModes,
    refreshSessions,
    saveAgentsForSelectedMode,
    saveOperationModeSettings,
    selectOperationMode,
    updateCurrentSessionProjectPaths,
    openProjectFolder,
  } = createSessionModeController({
    agents,
    currentSessionId,
    modeDefaultModels,
    modeIcons,
    modeProjectPaths,
    modes,
    selectedMode,
    settings,
    setAgents,
    setCurrentSessionId,
    setCurrentSessionProjectPaths,
    setCurrentSessionTitle,
    setIsSessionLoading,
    setMessages,
    setModeDefaultModels,
    setModeIcons,
    setModeProjectPaths,
    setModes,
    setSelectedMode,
    setSessionsByMode,
    resetCurrentSession,
  });

  useEffect(() => {
    void loadOperationModes();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setResourceToken((value) => Math.min(9999, value + 9));
      setResourceCost((value) => Number((value + 0.001).toFixed(3)));
    }, 6500);

    return () => clearInterval(timer);
  }, []);

  const canSend = inputValue.trim().length > 0 && !isLoading && !isSessionLoading;

  const tokenPercent = useMemo(() => {
    return Math.max(5, Math.min(90, Math.round((resourceToken / 12000) * 100)));
  }, [resourceToken]);

  const costPercent = useMemo(() => {
    return Math.max(10, Math.min(65, Math.round((resourceCost / 0.35) * 100)));
  }, [resourceCost]);

  const resolveProviderSettings = async (): Promise<ResolvedLLMSettings> => {
    try {
      const next = await invoke<ResolvedLLMSettings>("resolve_llm_settings");
      return {
        ...normalizeLlmSettings(next),
        accessToken: next.accessToken,
        accountId: next.accountId,
      };
    } catch {
      return normalizeLlmSettings(settings);
    }
  };

  const persistMessage = async (sessionId: string, message: Message) => {
    await invoke("append_chat_message", {
      input: {
        sessionId,
        message,
      },
    });
  };

  const ensureSession = async (text: string) => {
    if (currentSessionId) {
      return {
        id: currentSessionId,
        title: currentSessionTitle,
        projectPaths: currentSessionProjectPaths,
      };
    }

    const created = await invoke<SessionItem>("create_chat_session", {
      input: {
        title: buildSessionTitle(text),
        modeName: selectedMode,
      },
    });

    setCurrentSessionId(created.id);
    setCurrentSessionTitle(created.title);
    setCurrentSessionProjectPaths(created.projectPaths || []);
    await refreshSessions(modes, created.id);

    return created;
  };

  const { sendMessage } = useChatSendMessage({
    agents,
    canSend,
    currentSessionId,
    ensureSession,
    inputValue,
    messages,
    modes,
    persistMessage,
    refreshSessions,
    resolveProviderSettings,
    setActivity,
    setInputValue,
    setIsLoading,
    setMessages,
    setOpenSelectedModeSignal,
    setResourceCost,
    setResourceToken,
  });

  const appendStatusMessage = (text: string): void => {
    setMessages((prev) => [
      ...prev,
      {
        id: `status-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        side: "status",
        type: "status",
        statusText: text,
      },
    ]);
  };

  const handleApprovePlan = () => {
    appendStatusMessage("계획을 승인했고 다음 단계를 진행합니다.");
  };

  const handleModifyPlan = () => {
    setInputValue("계획에서 수정하거나 보완할 내용을 정리해 주세요.");
    appendStatusMessage("계획 수정 요청을 남겼습니다.");
  };

  const clearContext = () => {
    resetCurrentSession();
    setActivity([...INITIAL_ACTIVITY]);
    void refreshSessions(modes, null);
  };

  const startNewChat = () => {
    resetCurrentSession();
    setActivity([...INITIAL_ACTIVITY]);
    void refreshSessions(modes, null);
  };

  const exportChat = async () => {
    const text = messages
      .map((item) => {
        if (item.side === "status") {
          return `[status] ${item.statusText}`;
        }

        return `${item.sender} ${item.byline || ""}\n${item.text || ""}`;
      })
      .join("\n\n");

    if (!navigator?.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(text);
  };

  const onEnterSubmit = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  return {
    activity,
    agents,
    canSend,
    clearContext,
    costPercent,
    currentSessionId,
    currentSessionProjectPaths,
    currentSessionTitle,
    exportChat,
    getModeDefaultModel,
    getModeIcon,
    getModeProjectPaths,
    handleApprovePlan,
    handleModifyPlan,
    handleSessionDelete,
    handleSessionSelect,
    inputValue,
    messages,
    modes,
    onEnterSubmit,
    openProjectFolder,
    openSelectedModeSignal,
    resourceCost,
    resourceToken,
    saveAgentsForSelectedMode,
    saveOperationModeSettings,
    selectOperationMode,
    selectedMode,
    sendMessage,
    sessionsByMode,
    setInputValue,
    startNewChat,
    tokenPercent,
    updateCurrentSessionProjectPaths,
  };
}
