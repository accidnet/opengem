import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";

import { resolveLlmSettings } from "@/features/backend/api";
import {
  AGENTS,
  DEFAULT_MODE_ICONS,
  MODES,
  SESSION_MESSAGES,
  type Mode,
  type ModeIcon,
} from "@/features/app/config/appData";
import { normalizeLlmSettings } from "@/features/ai/catalog";
import { buildActivityFromMessages, buildSessionTitle } from "@/pages/chat/utils";
import type {
  AgentItem,
  LLMSettings,
  Message,
  ResolvedLLMSettings,
  SessionItem,
} from "@/types/chat";
import { getErrorMessage, normalizeAgentsForUi } from "@/features/app/appHelpers";
import {
  conversationDraftKey,
  findAgentSession,
  resolveConversationAgent,
} from "@/pages/chat/conversationTarget";
import { createSessionModeController } from "@/hooks/sessionModeController";
import { useChatSendMessage } from "./useChatSendMessage";

type UseChatControllerParams = {
  settings: LLMSettings;
  isInstallingUpdate: boolean;
  isInstallingRef: RefObject<boolean>;
};

export function useChatController({
  settings,
  isInstallingUpdate,
  isInstallingRef,
}: UseChatControllerParams) {
  const [messages, setMessages] = useState<Message[]>(SESSION_MESSAGES);
  const [sessionsByMode, setSessionsByMode] = useState<Record<Mode, SessionItem[]>>({});
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState("");
  const [isTransitioning, setIsTransitioning] = useState(true);
  const conversationLockRef = useRef(false);
  const initialLoadRef = useRef<Promise<void> | null>(null);
  const draftsRef = useRef(new Map<string, string>());
  const [currentSessionTitle, setCurrentSessionTitle] = useState("새 채팅");
  const [currentSessionProjectPaths, setCurrentSessionProjectPaths] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [executionMode, setExecutionMode] = useState<"chat" | "codex" | "computer">("chat");
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
    setCurrentAgentId(null);
    setCurrentSessionTitle("새 채팅");
    setCurrentSessionProjectPaths([]);
    setInputValue("");
  };

  const {
    getModeDefaultModel,
    getModeIcon,
    getModeProjectPaths,
    handleSessionDelete: selectDeleteSession,
    handleSessionSelect: selectSavedSession,
    loadSession,
    loadOperationModes,
    refreshSessions,
    saveAgentsForSelectedMode: persistAgents,
    saveOperationModeSettings: persistModes,
    selectOperationMode: selectMode,
    updateCurrentSessionProjectPaths: persistSessionProjectPaths,
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
    setCurrentAgentId,
    restoreDraft: (session) => {
      setInputValue(
        draftsRef.current.get(
          conversationDraftKey(session.id, session.modeName, session.agentId ?? null)
        ) ?? ""
      );
    },
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
    conversationLockRef.current = true;
    // StrictMode에서 효과가 재실행되어도 같은 초기화 작업을 기다립니다.
    initialLoadRef.current ??= loadOperationModes();
    void initialLoadRef.current
      .catch((error) => setConversationError(getErrorMessage(error)))
      .finally(() => {
        conversationLockRef.current = false;
        setIsTransitioning(false);
      });
    // 컨트롤러 팩토리가 매 렌더마다 함수를 생성하므로 초기 로드만 실행합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setResourceToken((value) => Math.min(9999, value + 9));
      setResourceCost((value) => Number((value + 0.001).toFixed(3)));
    }, 6500);

    return () => clearInterval(timer);
  }, []);

  // 다른 에이전트로 이동할 때 개발 실행을 다시 명시적으로 선택합니다.
  useEffect(() => setExecutionMode("chat"), [currentAgentId]);

  const conversationAgent = resolveConversationAgent(agents, currentAgentId);
  const unavailableReason =
    !currentAgentId && !conversationAgent
      ? "대화할 에이전트가 없습니다. 에이전트 설정에서 추가해 주세요."
      : currentAgentId && !conversationAgent
        ? "이 대화의 에이전트가 삭제되었습니다. 기존 기록만 확인할 수 있어요."
        : currentAgentId && !conversationAgent?.active
          ? "비활성 에이전트입니다. 에이전트 설정에서 활성화한 뒤 대화할 수 있어요."
          : "";
  const isConversationBusy = isLoading || isSessionLoading || isTransitioning || isInstallingUpdate;
  const canSend = inputValue.trim().length > 0 && !isConversationBusy && !unavailableReason;

  const rememberDraft = () => {
    draftsRef.current.set(
      conversationDraftKey(currentSessionId, selectedMode, currentAgentId),
      inputValue
    );
  };

  // 화면을 바꾸는 작업과 응답 생성을 직렬화해 다른 대화로 결과가 새지 않게 합니다.
  const changeConversation = async (action: () => Promise<void>, rethrow = false) => {
    if (conversationLockRef.current || isInstallingRef.current) {
      if (rethrow) throw new Error("진행 중인 작업이 끝난 뒤 다시 시도해 주세요.");
      return false;
    }
    conversationLockRef.current = true;
    setIsTransitioning(true);
    setConversationError("");
    rememberDraft();
    try {
      await action();
      return true;
    } catch (error) {
      setConversationError(getErrorMessage(error));
      if (rethrow) throw error;
      return false;
    } finally {
      conversationLockRef.current = false;
      setIsTransitioning(false);
    }
  };

  const startAgentChat = (agent: AgentItem) =>
    changeConversation(async () => {
      if (!agent.agentId) throw new Error("에이전트를 저장한 뒤 개별 대화를 시작해 주세요.");
      if (currentAgentId === agent.agentId) return;
      const sessions = await invoke<SessionItem[]>("list_chat_sessions");
      const existing = findAgentSession(sessions, selectedMode, agent.agentId);
      if (existing) {
        await loadSession(existing.id);
      } else {
        await refreshSessions(modes, null);
        resetCurrentSession();
        setCurrentAgentId(agent.agentId);
        setCurrentSessionTitle(`${agent.name}와 대화`);
        setInputValue(
          draftsRef.current.get(conversationDraftKey(null, selectedMode, agent.agentId)) ?? ""
        );
      }
    });

  const handleSessionSelect = (session: SessionItem) =>
    changeConversation(() => selectSavedSession(session));
  const handleSessionDelete = (session: SessionItem) =>
    changeConversation(() => selectDeleteSession(session));
  const selectOperationMode = (mode: Mode) => changeConversation(() => selectMode(mode));
  const saveAgentsForSelectedMode = async (next: AgentItem[]) => {
    await changeConversation(() => persistAgents(next), true);
  };
  const saveOperationModeSettings = async (...args: Parameters<typeof persistModes>) => {
    await changeConversation(() => persistModes(...args), true);
  };
  const updateCurrentSessionProjectPaths = async (paths: string[]) => {
    await changeConversation(() => persistSessionProjectPaths(paths), true);
  };

  const activity = useMemo(() => buildActivityFromMessages(messages), [messages]);

  const tokenPercent = useMemo(() => {
    return Math.max(5, Math.min(90, Math.round((resourceToken / 12000) * 100)));
  }, [resourceToken]);

  const costPercent = useMemo(() => {
    return Math.max(10, Math.min(65, Math.round((resourceCost / 0.35) * 100)));
  }, [resourceCost]);

  const resolveProviderSettings = async (): Promise<ResolvedLLMSettings> => {
    try {
      const next = await resolveLlmSettings();
      return {
        ...normalizeLlmSettings({ ...settings, ...next }),
        baseUrl: next.baseUrl,
        model: next.model,
        accessToken: next.accessToken,
        accountId: next.accountId,
      };
    } catch {
      return {
        ...normalizeLlmSettings(settings),
        baseUrl: settings.baseUrl,
        model: settings.model,
      };
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
        updatedAt: Date.now(),
        modeName: selectedMode,
        projectPaths: currentSessionProjectPaths,
        agentId: currentAgentId,
      };
    }

    const created = await invoke<SessionItem>("create_chat_session", {
      input: {
        title: buildSessionTitle(text),
        modeName: selectedMode,
        agentId: currentAgentId,
      },
    });

    setCurrentSessionId(created.id);
    setCurrentSessionTitle(created.title);
    setCurrentSessionProjectPaths(created.projectPaths || []);
    await refreshSessions(modes, created.id);

    return created;
  };

  const {
    sendMessage: sendChatMessage,
    cancelCodexTask,
    isCodexRunning,
    cancelComputerTask,
    isComputerRunning,
  } = useChatSendMessage({
    executionMode,
    agents,
    targetAgentId: currentAgentId,
    conversationLockRef,
    canSend,
    currentSessionId,
    ensureSession,
    inputValue,
    messages,
    modes,
    persistMessage,
    refreshSessions: async (nextModes, nextSessionId) => {
      await refreshSessions(nextModes, nextSessionId);
    },
    resolveProviderSettings,
    setInputValue,
    setIsLoading,
    setMessages,
    setOpenSelectedModeSignal,
    setResourceCost,
    setResourceToken,
  });

  // 설치 요청 직후 렌더링되기 전에도 새 메시지 전송을 막습니다.
  const sendMessage = async () => {
    if (isInstallingRef.current) return;
    await sendChatMessage();
  };

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
    if (conversationLockRef.current) return;
    appendStatusMessage("계획을 승인했고 다음 단계를 진행합니다.");
  };

  const handleModifyPlan = () => {
    if (conversationLockRef.current) return;
    setInputValue("계획에서 수정하거나 보완할 내용을 정리해 주세요.");
    appendStatusMessage("계획 수정 요청을 남겼습니다.");
  };

  const clearContext = () => {
    return changeConversation(async () => {
      await refreshSessions(modes, null);
      resetCurrentSession();
      setCurrentAgentId(currentAgentId);
    });
  };

  const startNewChat = () => {
    return changeConversation(async () => {
      await refreshSessions(modes, null);
      resetCurrentSession();
    });
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
    executionMode,
    setExecutionMode,
    cancelCodexTask,
    isCodexRunning,
    cancelComputerTask,
    isComputerRunning,
    canSend,
    clearContext,
    costPercent,
    currentSessionId,
    currentAgentId,
    conversationAgent,
    conversationError,
    unavailableReason,
    isConversationBusy,
    startAgentChat,
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
