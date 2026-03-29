import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";

import { sendToLLM } from "./lib/llm";
import { AppHeader } from "./components/layout/AppHeader";
import { ChatPanel } from "./components/layout/ChatPanel";
import { LeftPanel } from "./components/layout/LeftPanel";
import { RightPanel } from "./components/layout/RightPanel";
import { ProviderDialog } from "./components/layout/ProviderDialog";
import {
  AGENTS,
  DEFAULT_MODE_ICONS,
  INITIAL_ACTIVITY,
  LLM_CONFIG,
  MODE_ICON_OPTIONS,
  MODES,
  SESSION_MESSAGES,
  TOOLS,
  type ModeIcon,
  type Mode,
} from "./data/appData";
import {
  AGENT_COLOR_VALUES,
  appendChunkToMessage,
  buildActivity,
  buildLLMMessages,
  buildReplyMessage,
  buildSessionTitle,
  buildTypingMessage,
  nowTime,
} from "./utils/chat";
import type {
  ActivityItem,
  AgentItem,
  LLMSettings,
  Message,
  OperationModeState,
  ResolvedLLMSettings,
  SessionDetail,
  SessionItem,
  ThemeMode,
} from "./types/chat";

type StartChatgptLoginPayload = {
  authorizationUrl: string;
};

type OperationModeInput = {
  name: string;
  originalName?: string;
};

type PersistedAgent = Omit<AgentItem, "status">;

const toAgentStatus = (active?: boolean) => {
  return active ? "대기 중" : "오프라인";
};

const normalizeAgentsForUi = (items: PersistedAgent[]) => {
  return items.map((agent) => ({
    ...agent,
    status: toAgentStatus(agent.active),
  }));
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return "알 수 없는 오류가 발생했습니다.";
};

async function openExternalUrl(url: string): Promise<void> {
  await invoke("open_external_url", { url });
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>(SESSION_MESSAGES);
  const [sessionsByMode, setSessionsByMode] = useState<Record<Mode, SessionItem[]>>({});
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSessionTitle, setCurrentSessionTitle] = useState("새 채팅");
  const [activity, setActivity] = useState<ActivityItem[]>(INITIAL_ACTIVITY);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [modes, setModes] = useState<Mode[]>([...MODES]);
  const [selectedMode, setSelectedMode] = useState<Mode>(MODES[0]);
  const [modeIcons, setModeIcons] = useState<Record<Mode, ModeIcon>>({ ...DEFAULT_MODE_ICONS });
  const [resourceToken, setResourceToken] = useState(2405);
  const [resourceCost, setResourceCost] = useState(0.04);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [agents, setAgents] = useState<AgentItem[]>(normalizeAgentsForUi([...AGENTS]));
  const [settings, setSettings] = useState<LLMSettings>(LLM_CONFIG);
  const [isProviderDialogOpen, setIsProviderDialogOpen] = useState(false);
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [isChatGPTLoginBusy, setIsChatGPTLoginBusy] = useState(false);
  const [chatGPTLoginUrl, setChatGPTLoginUrl] = useState("");
  const [providerError, setProviderError] = useState("");
  const [openSelectedModeSignal, setOpenSelectedModeSignal] = useState(0);

  useEffect(() => {
    void loadOperationModes();
    void loadProviderSettings();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const loadProviderSettings = async () => {
    try {
      const next = await invoke<LLMSettings>("get_llm_settings");
      setSettings((prev) => ({ ...prev, ...next }));
      setProviderError("");
    } catch {
      setSettings((prev) => ({ ...LLM_CONFIG, ...prev }));
    }
  };

  const applySessionList = (
    nextSessions: SessionItem[],
    nextModes: ReadonlyArray<Mode>,
    activeSessionId?: string | null
  ) => {
    const resolvedActiveSessionId =
      activeSessionId === undefined ? currentSessionId : activeSessionId;
    const grouped = nextModes.reduce<Record<Mode, SessionItem[]>>(
      (acc, mode) => {
        acc[mode] = [];
        return acc;
      },
      {} as Record<Mode, SessionItem[]>
    );

    nextSessions.forEach((session) => {
      const normalizedSession = {
        ...session,
        active: session.id === resolvedActiveSessionId,
      };

      if (!grouped[session.modeName]) {
        grouped[session.modeName] = [];
      }

      grouped[session.modeName].push(normalizedSession);
    });

    setSessionsByMode(grouped);
  };

  const refreshSessions = async (
    nextModes: ReadonlyArray<Mode>,
    activeSessionId?: string | null
  ) => {
    const nextSessions = await invoke<SessionItem[]>("list_chat_sessions");
    applySessionList(nextSessions, nextModes, activeSessionId);
    return nextSessions;
  };

  const resetCurrentSession = () => {
    setMessages(SESSION_MESSAGES);
    setCurrentSessionId(null);
    setCurrentSessionTitle("새 채팅");
    setInputValue("");
  };

  const loadSession = async (sessionId: string, nextModes: ReadonlyArray<Mode> = modes) => {
    setIsSessionLoading(true);
    try {
      const detail = await invoke<SessionDetail>("get_chat_session", { sessionId });
      setCurrentSessionId(detail.session.id);
      setCurrentSessionTitle(detail.session.title);
      setMessages(detail.messages);
      await refreshSessions(nextModes, detail.session.id);
    } finally {
      setIsSessionLoading(false);
    }
  };

  const syncModeSessions = async (
    mode: Mode,
    nextModes: ReadonlyArray<Mode>,
    preferredSessionId?: string | null
  ) => {
    const nextSessions = await refreshSessions(nextModes, preferredSessionId);
    const modeSessions = nextSessions.filter((session) => session.modeName === mode);
    const candidateSessionId =
      preferredSessionId && modeSessions.some((session) => session.id === preferredSessionId)
        ? preferredSessionId
        : modeSessions[0]?.id;

    if (!candidateSessionId) {
      resetCurrentSession();
      return;
    }

    if (candidateSessionId === currentSessionId) {
      await refreshSessions(nextModes, candidateSessionId);
      return;
    }

    await loadSession(candidateSessionId, nextModes);
  };

  const loadOperationModes = async () => {
    try {
      const next = await invoke<OperationModeState>("load_operation_mode");
      if (next.modes.length === 0) {
        return;
      }

      setModes(next.modes);
      setSelectedMode(next.selectedMode);
      try {
        const nextAgents = await invoke<PersistedAgent[]>("load_mode_agents", {
          modeName: next.selectedMode,
        });
        setAgents(normalizeAgentsForUi(nextAgents));
      } catch {
        setAgents(normalizeAgentsForUi([...AGENTS]));
      }
      setModeIcons((prev) => {
        const nextIcons = { ...prev };
        next.modes.forEach((mode, index) => {
          if (!nextIcons[mode]) {
            nextIcons[mode] = index === 0 ? "smart_toy" : "tune";
          }
        });
        return nextIcons;
      });
      await syncModeSessions(next.selectedMode, next.modes, null);
    } catch {
      setModes([...MODES]);
      setSelectedMode(MODES[0]);
      setAgents(normalizeAgentsForUi([...AGENTS]));
      setSessionsByMode({});
    }
  };

  const persistOperationModes = async (nextModes: OperationModeInput[], nextSelectedMode: Mode) => {
    await invoke("save_operation_mode", {
      modes: nextModes,
      selectedMode: nextSelectedMode,
    });
  };

  const loadAgentsForMode = async (mode: Mode) => {
    try {
      const nextAgents = await invoke<PersistedAgent[]>("load_mode_agents", {
        modeName: mode,
      });
      setAgents(normalizeAgentsForUi(nextAgents));
    } catch {
      setAgents(normalizeAgentsForUi([...AGENTS]));
    }
  };

  const selectOperationMode = async (mode: Mode) => {
    const previousMode = selectedMode;
    const previousAgents = agents;
    setSelectedMode(mode);

    try {
      await invoke("select_operation_mode", { selectedMode: mode });
      await loadAgentsForMode(mode);
      await syncModeSessions(mode, modes, null);
    } catch {
      setSelectedMode(previousMode);
      setAgents(previousAgents);
    }
  };

  const resolveProviderSettings = async (): Promise<ResolvedLLMSettings> => {
    try {
      return await invoke<ResolvedLLMSettings>("resolve_llm_settings");
    } catch {
      return settings;
    }
  };

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
    await refreshSessions(modes, created.id);

    return created;
  };

  const replaceTypingMessage = (typingMessageId: string, nextMessage: Message) => {
    setMessages((prev) =>
      prev.map((entry) => (entry.id === typingMessageId ? nextMessage : entry))
    );
  };

  const sendMessage = async (): Promise<void> => {
    if (!canSend) {
      return;
    }

    const text = inputValue.trim();
    if (!text) {
      return;
    }

    const isFirstMessageInFreshSession = currentSessionId === null && messages.length === 0;
    if (isFirstMessageInFreshSession) {
      setOpenSelectedModeSignal((prev) => prev + 1);
    }

    const userMessage: Message = {
      id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      side: "user",
      sender: "사용자",
      byline: nowTime(),
      avatarText: "JD",
      type: "text",
      text,
    };

    // 현재 모드에서 role이 'main'인 에이전트를 찾는다. 없으면 첫 번째 에이전트 사용
    const mainAgent = agents.find((a) => a.role === "main") ?? agents[0];
    const typingMessage = buildTypingMessage(
      "응답을 생성 중입니다...",
      mainAgent?.name,
      mainAgent?.icon,
      mainAgent?.color ? (AGENT_COLOR_VALUES[mainAgent.color] ?? "#86efac") : undefined
    );

    setMessages((prev) => [...prev, userMessage, typingMessage]);
    setInputValue("");
    setIsLoading(true);

    let activeSessionId = currentSessionId;

    try {
      const session = await ensureSession(text);
      activeSessionId = session.id;
      await persistMessage(session.id, userMessage);

      const sessionDetail = await invoke<SessionDetail>("get_chat_session", {
        sessionId: session.id,
      });
      // main 에이전트의 프롬프트를 system prompt로 주입 (없으면 기본값 사용)
      const requestMessages = buildLLMMessages(sessionDetail.messages, mainAgent?.prompt ?? undefined);
      const activeSettings = await resolveProviderSettings();

      if (activeSettings.providerKind === "chatgpt_oauth" && !activeSettings.accessToken) {
        const loginMessage: Message = {
          ...typingMessage,
          type: "text",
          text: "ChatGPT 로그인이 필요합니다. 프로바이더 메뉴에서 다시 로그인해줘.",
        };
        replaceTypingMessage(typingMessage.id, loginMessage);
        await persistMessage(session.id, loginMessage);
        await refreshSessions(modes, session.id);
        return;
      }

      if (activeSettings.providerKind !== "chatgpt_oauth" && !activeSettings.apiKey) {
        const fallbackReply = buildReplyMessage(text);
        replaceTypingMessage(typingMessage.id, fallbackReply);
        await persistMessage(session.id, fallbackReply);
        await refreshSessions(modes, session.id);
        setActivity((prev) => [
          ...prev,
          buildActivity("샘플 응답으로 대체되었습니다 (API 키 없음).", mainAgent?.name ?? "기획자"),
        ]);
        return;
      }

      setMessages((prev) =>
        prev.map((entry) =>
          entry.id === typingMessage.id
            ? {
                ...entry,
                type: "text",
                text: "",
              }
            : entry
        )
      );

      let streamedText = "";
      // main 에이전트에 설정된 모델 우선 사용, 없으면 프로바이더 기본 모델로 폴백
      const resolvedModel =
        activeSettings.providerKind === "chatgpt_oauth"
          ? activeSettings.model
          : mainAgent?.model?.trim() || activeSettings.model;
      const response = await sendToLLM({
        providerKind: activeSettings.providerKind,
        apiBaseUrl: activeSettings.baseUrl,
        apiKey: activeSettings.apiKey,
        accessToken: activeSettings.accessToken,
        accountId: activeSettings.accountId,
        model: resolvedModel,
        messages: requestMessages,
        stream: true,
        onChunk: (chunk) => {
          streamedText += chunk;
          setMessages((prev) => appendChunkToMessage(prev, typingMessage.id, streamedText));
        },
      });

      const assistantMessage: Message = {
        ...typingMessage,
        type: "text",
        text: response.text || streamedText || "(빈 응답)",
      };

      replaceTypingMessage(typingMessage.id, assistantMessage);
      await persistMessage(session.id, assistantMessage);
      await refreshSessions(modes, session.id);

      const totalTokens = response.usage?.totalTokens;
      if (typeof totalTokens === "number") {
        setResourceToken((prev) => Math.min(9999, prev + totalTokens));
      }

      const estimatedCost = response.usage?.totalTokens ? response.usage.totalTokens * 0.000005 : 0;
      if (estimatedCost > 0) {
        setResourceCost((prev) => Number((prev + estimatedCost).toFixed(3)));
      }

      const usageText = response.usage?.totalTokens
        ? ` 토큰 ${response.usage.totalTokens}개 사용`
        : "";
      setActivity((prev) => [
        ...prev,
        buildActivity(`에이전트 응답 수신 완료${usageText}`.trim(), "기획자"),
      ]);
    } catch (error) {
      const reason = getErrorMessage(error);
      const errorMessage: Message = {
        ...typingMessage,
        type: "text",
        text: `요청 처리 실패: ${reason}`,
      };
      replaceTypingMessage(typingMessage.id, errorMessage);

      if (activeSessionId) {
        try {
          await persistMessage(activeSessionId, errorMessage);
          await refreshSessions(modes, activeSessionId);
        } catch {
          // 저장 실패는 화면 응답을 막지 않음
        }
      }

      setActivity((prev) => [
        ...prev,
        buildActivity("LLM 응답 수신 중 오류가 발생했습니다.", "시스템"),
      ]);
    } finally {
      setIsLoading(false);
    }
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
    appendStatusMessage("사용자가 계획을 승인했습니다");
  };

  const handleModifyPlan = () => {
    setInputValue("실행 전에 계획을 구체적으로 수정해줘.");
    appendStatusMessage("사용자가 계획 수정 요청");
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

  const handleSessionSelect = async (session: SessionItem) => {
    if (session.id === currentSessionId) {
      return;
    }

    try {
      if (session.modeName !== selectedMode) {
        setSelectedMode(session.modeName);
        await invoke("select_operation_mode", { selectedMode: session.modeName });
        await loadAgentsForMode(session.modeName);
      }

      await loadSession(session.id, modes);
    } catch {
      // 세션 불러오기 실패는 activity log에 기록하지 않음
    }
  };

  const handleSessionDelete = async (session: SessionItem) => {
    try {
      await invoke("delete_chat_session", { sessionId: session.id });

      const nextSessions = await refreshSessions(modes, null);

      if (session.id !== currentSessionId) {
        return;
      }

      const sameModeSessions = nextSessions.filter((item) => item.modeName === session.modeName);
      const fallbackSession = sameModeSessions[0];

      if (!fallbackSession) {
        resetCurrentSession();
        if (session.modeName !== selectedMode) {
          setSelectedMode(session.modeName);
          await loadAgentsForMode(session.modeName);
        }
        return;
      }

      if (session.modeName !== selectedMode) {
        setSelectedMode(session.modeName);
        await invoke("select_operation_mode", { selectedMode: session.modeName });
        await loadAgentsForMode(session.modeName);
      }

      await loadSession(fallbackSession.id, modes);
    } catch {
      // 세션 삭제 실패는 현재 화면 상태를 유지
    }
  };

  const saveOperationModeSettings = async (
    nextModes: Mode[],
    nextModeIcons: Record<Mode, ModeIcon>,
    nextSelectedMode: Mode,
    modeItems: OperationModeInput[]
  ) => {
    const previousModes = modes;
    const previousModeIcons = modeIcons;
    const previousSelectedMode = selectedMode;
    const previousAgents = agents;

    setModes(nextModes);
    setModeIcons(nextModeIcons);
    setSelectedMode(nextSelectedMode);

    try {
      await persistOperationModes(modeItems, nextSelectedMode);
      await loadAgentsForMode(nextSelectedMode);
      await syncModeSessions(nextSelectedMode, nextModes, null);
    } catch {
      setModes(previousModes);
      setModeIcons(previousModeIcons);
      setSelectedMode(previousSelectedMode);
      setAgents(previousAgents);
      void loadOperationModes();
      return;
    }

    // Operation Mode 저장은 activity log에 기록하지 않음
  };

  const getModeIcon = (mode: Mode): ModeIcon => {
    return modeIcons[mode] || MODE_ICON_OPTIONS[2];
  };

  const saveAgentsForSelectedMode = async (nextAgents: AgentItem[]) => {
    const previousAgents = agents;
    const normalizedAgents = normalizeAgentsForUi(
      nextAgents.map(({ status: _status, ...agent }) => ({
        ...agent,
      }))
    );

    setAgents(normalizedAgents);

    try {
      await invoke("save_mode_agents", {
        modeName: selectedMode,
        agents: normalizedAgents.map(({ status: _status, ...agent }) => agent),
      });
    } catch {
      setAgents(previousAgents);
      throw new Error("에이전트 설정 저장에 실패했습니다.");
    }
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
      sendMessage();
    }
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const saveProviderSettings = async () => {
    setIsSavingProvider(true);
    try {
      const next = await invoke<LLMSettings>("save_llm_settings", { input: settings });
      setSettings(next);
      setProviderError("");
      setIsProviderDialogOpen(false);
    } catch (error) {
      setProviderError(
        error instanceof Error ? error.message : "프로바이더 설정을 저장하지 못했습니다."
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
      const auth = await invoke<StartChatgptLoginPayload>("begin_chatgpt_login");
      setChatGPTLoginUrl(auth.authorizationUrl);
      await openExternalUrl(auth.authorizationUrl);
      setProviderError("");
      setIsChatGPTLoginBusy(false);

      const timeoutAt = Date.now() + 305_000;
      while (Date.now() < timeoutAt) {
        await new Promise((resolve) => {
          setTimeout(resolve, 1200);
        });

        const next = await invoke<LLMSettings>("get_llm_settings");
        setSettings((prev) => ({ ...prev, ...next }));
        if (next.chatgptLoggedIn) {
          setChatGPTLoginUrl("");
          return;
        }
      }

      setProviderError("로그인 완료를 확인하지 못했습니다. 링크를 다시 열어 인증 상태를 확인해줘.");
    } catch (error) {
      setProviderError(
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
      setSettings(next);
      setChatGPTLoginUrl("");
      setProviderError("");
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : "ChatGPT 로그아웃에 실패했습니다.");
    } finally {
      setIsChatGPTLoginBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <AppHeader
        theme={theme}
        isLoggedIn={settings.chatgptLoggedIn}
        sessionTitle={currentSessionTitle}
        hasActiveSession={Boolean(currentSessionId)}
        onNewChat={startNewChat}
        onExportChat={exportChat}
        onClearContext={clearContext}
        onThemeToggle={toggleTheme}
        onOpenProviderDialog={() => setIsProviderDialogOpen(true)}
      />

      <main className="body-grid">
        <LeftPanel
          modes={modes}
          selectedMode={selectedMode}
          openSelectedModeSignal={openSelectedModeSignal}
          onModeSelect={selectOperationMode}
          onSaveModeSettings={saveOperationModeSettings}
          onSaveAgents={saveAgentsForSelectedMode}
          getModeIcon={getModeIcon}
          agents={agents}
          sessionsByMode={sessionsByMode}
          onSessionSelect={handleSessionSelect}
          onSessionDelete={handleSessionDelete}
          tools={TOOLS}
        />

        <ChatPanel
          messages={messages}
          inputValue={inputValue}
          canSend={canSend}
          onInputChange={(value) => setInputValue(value)}
          onSubmit={sendMessage}
          onEnterSubmit={onEnterSubmit}
          onApprovePlan={handleApprovePlan}
          onModifyPlan={handleModifyPlan}
        />

        <RightPanel
          activity={activity}
          resourceToken={resourceToken}
          resourceCost={resourceCost}
          tokenPercent={tokenPercent}
          costPercent={costPercent}
        />
      </main>

      <ProviderDialog
        settings={settings}
        isOpen={isProviderDialogOpen}
        isSaving={isSavingProvider}
        isLoginBusy={isChatGPTLoginBusy}
        loginUrl={chatGPTLoginUrl}
        errorMessage={providerError}
        onClose={() => setIsProviderDialogOpen(false)}
        onChange={(patch) => {
          setSettings((prev) => ({ ...prev, ...patch }));
          if (providerError) {
            setProviderError("");
          }
        }}
        onSave={saveProviderSettings}
        onLoginChatGPT={loginChatGPT}
        onLogoutChatGPT={logoutChatGPT}
      />
    </div>
  );
}
