import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Dispatch, SetStateAction } from "react";

import { getChatSession } from "@/features/backend/api";
import { findLatestConversationSession } from "@/pages/chat/conversationTarget";
import {
  AGENTS,
  LLM_CONFIG,
  MODE_ICON_OPTIONS,
  MODES,
  type Mode,
  type ModeIcon,
} from "@/features/app/config/appData";
import type {
  AgentItem,
  LLMSettings,
  OperationModeState,
  SessionDetail,
  SessionItem,
} from "@/types/chat";

import {
  normalizeAgentsForUi,
  type OperationModeInput,
  type PersistedAgent,
} from "@/features/app/appHelpers";

type Setter<T> = Dispatch<SetStateAction<T>>;

type SessionModeControllerParams = {
  currentAgentId: string | null;
  currentSessionId: string | null;
  modeDefaultModels: Record<Mode, string>;
  modeIcons: Record<Mode, ModeIcon>;
  modeProjectPaths: Record<Mode, string[]>;
  modes: Mode[];
  selectedMode: Mode;
  settings: LLMSettings;
  setAgents: Setter<AgentItem[]>;
  setCurrentSessionId: Setter<string | null>;
  setCurrentAgentId: Setter<string | null>;
  hasNewDraft: (mode: Mode, agentId: string | null) => boolean;
  onModesSaved: (modeItems: OperationModeInput[]) => void;
  restoreDraft: (session: SessionItem) => void;
  setCurrentSessionProjectPaths: Setter<string[]>;
  setCurrentSessionTitle: Setter<string>;
  setMessages: Setter<SessionDetail["messages"]>;
  setModeDefaultModels: Setter<Record<Mode, string>>;
  setModeIcons: Setter<Record<Mode, ModeIcon>>;
  setModeProjectPaths: Setter<Record<Mode, string[]>>;
  setModes: Setter<Mode[]>;
  setSelectedMode: Setter<Mode>;
  setSessionsByMode: Setter<Record<Mode, SessionItem[]>>;
  resetCurrentSession: (mode: Mode, agentId: string | null) => void;
};

export function createSessionModeController({
  currentAgentId,
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
  hasNewDraft,
  onModesSaved,
  restoreDraft,
  setCurrentSessionProjectPaths,
  setCurrentSessionTitle,
  setMessages,
  setModeDefaultModels,
  setModeIcons,
  setModeProjectPaths,
  setModes,
  setSelectedMode,
  setSessionsByMode,
  resetCurrentSession,
}: SessionModeControllerParams) {
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

  const applySessionDetail = (detail: SessionDetail) => {
    setCurrentSessionId(detail.session.id);
    setCurrentAgentId(detail.session.agentId ?? null);
    restoreDraft(detail.session);
    setCurrentSessionTitle(detail.session.title);
    setCurrentSessionProjectPaths(detail.session.projectPaths || []);
    setMessages(detail.messages);
  };

  const prepareModeSessions = async (
    mode: Mode,
    nextModes: ReadonlyArray<Mode>,
    agentId: string | null = null,
    preferredSessionId?: string | null
  ) => {
    const nextSessions = await invoke<SessionItem[]>("list_chat_sessions");
    let session = nextSessions.find(
      (item) =>
        item.id === preferredSessionId &&
        item.modeName === mode &&
        (item.agentId ?? null) === agentId
    );
    // 작성 중인 새 대화가 있으면 같은 대상의 예전 기록으로 덮어쓰지 않습니다.
    if (!session && !hasNewDraft(mode, agentId)) {
      session = findLatestConversationSession(nextSessions, mode, agentId);
    }
    const detail = session ? await getChatSession(session.id) : null;
    return { mode, agentId, nextSessions, nextModes, detail };
  };

  const applyPreparedSessions = (prepared: Awaited<ReturnType<typeof prepareModeSessions>>) => {
    if (prepared.detail) {
      applySessionDetail(prepared.detail);
    } else {
      resetCurrentSession(prepared.mode, prepared.agentId);
    }
    applySessionList(
      prepared.nextSessions,
      prepared.nextModes,
      prepared.detail?.session.id ?? null
    );
  };

  const fetchAgentsForMode = async (mode: Mode) => {
    const nextAgents = await invoke<PersistedAgent[]>("load_mode_agents", { modeName: mode });
    return normalizeAgentsForUi(nextAgents);
  };

  const loadAgentsForMode = async (mode: Mode) => {
    setAgents(await fetchAgentsForMode(mode));
  };

  const loadOperationModes = async () => {
    try {
      const next = await invoke<OperationModeState>("load_operation_mode");
      if (next.modes.length === 0) {
        return;
      }
      const [nextAgents, prepared] = await Promise.all([
        fetchAgentsForMode(next.selectedMode),
        prepareModeSessions(next.selectedMode, next.modes),
      ]);

      setModes(next.modes);
      setSelectedMode(next.selectedMode);
      setAgents(nextAgents);
      setModeProjectPaths(
        next.items.reduce<Record<Mode, string[]>>((acc, item) => {
          acc[item.name] = item.projectPaths || [];
          return acc;
        }, {})
      );
      setModeDefaultModels(
        next.items.reduce<Record<Mode, string>>((acc, item) => {
          acc[item.name] = item.defaultModel?.trim() || LLM_CONFIG.model;
          return acc;
        }, {})
      );

      const loadedModes = next.modes;
      setModeIcons((prev) => {
        const nextIcons = { ...prev };
        loadedModes.forEach((mode, index) => {
          if (!nextIcons[mode]) {
            nextIcons[mode] = index === 0 ? "smart_toy" : "tune";
          }
        });
        return nextIcons;
      });
      applyPreparedSessions(prepared);
    } catch {
      if (isTauri()) {
        setAgents([]);
        setSessionsByMode({});
        resetCurrentSession(selectedMode, null);
        throw new Error("저장된 작업 공간을 불러오지 못했습니다. 앱을 다시 열어 주세요.");
      }
      setModes([...MODES]);
      setSelectedMode(MODES[0]);
      setModeProjectPaths({});
      setModeDefaultModels({});
      setAgents(normalizeAgentsForUi([...AGENTS]));
      setSessionsByMode({});
      resetCurrentSession(MODES[0], null);
    }
  };

  const persistOperationModes = async (nextModes: OperationModeInput[], nextSelectedMode: Mode) => {
    await invoke("save_operation_mode", {
      modes: nextModes,
      selectedMode: nextSelectedMode,
    });
  };

  const selectOperationMode = async (mode: Mode) => {
    try {
      if (mode === selectedMode) {
        if (currentAgentId !== null) applyPreparedSessions(await prepareModeSessions(mode, modes));
        return;
      }
      const [nextAgents, prepared] = await Promise.all([
        fetchAgentsForMode(mode),
        prepareModeSessions(mode, modes),
      ]);
      await invoke("select_operation_mode", { selectedMode: mode });
      setSelectedMode(mode);
      setAgents(nextAgents);
      applyPreparedSessions(prepared);
    } catch {
      throw new Error("작업 모드를 불러오지 못했습니다.");
    }
  };

  const selectAgentConversation = async (agentId: string) => {
    if (currentAgentId !== agentId) {
      applyPreparedSessions(await prepareModeSessions(selectedMode, modes, agentId));
    }
  };

  const handleSessionSelect = async (session: SessionItem) => {
    if (session.id === currentSessionId) {
      return;
    }

    try {
      const changingMode = session.modeName !== selectedMode;
      const [detail, nextSessions, nextAgents] = await Promise.all([
        getChatSession(session.id),
        invoke<SessionItem[]>("list_chat_sessions"),
        changingMode ? fetchAgentsForMode(session.modeName) : Promise.resolve(null),
      ]);
      if (changingMode) {
        await invoke("select_operation_mode", { selectedMode: session.modeName });
        setSelectedMode(session.modeName);
        if (nextAgents) setAgents(nextAgents);
      }
      applySessionDetail(detail);
      applySessionList(nextSessions, modes, detail.session.id);
    } catch {
      throw new Error("대화 기록을 불러오지 못했습니다.");
    }
  };

  const handleSessionDelete = async (session: SessionItem) => {
    let deleted = false;
    try {
      await invoke("delete_chat_session", { sessionId: session.id });
      deleted = true;

      const nextSessions = await invoke<SessionItem[]>("list_chat_sessions");
      if (session.id !== currentSessionId) {
        applySessionList(nextSessions, modes, currentSessionId);
        return;
      }

      // 삭제한 대화와 같은 참여 범위에서만 다음 기록을 엽니다.
      const agentId = session.agentId ?? null;
      const fallbackSession = findLatestConversationSession(
        nextSessions,
        session.modeName,
        agentId
      );
      const detail = fallbackSession ? await getChatSession(fallbackSession.id) : null;
      if (detail) applySessionDetail(detail);
      else resetCurrentSession(session.modeName, agentId);
      applySessionList(nextSessions, modes, detail?.session.id ?? null);
    } catch {
      if (deleted) {
        setSessionsByMode((previous) =>
          Object.fromEntries(
            Object.entries(previous).map(([mode, sessions]) => [
              mode,
              sessions.filter((item) => item.id !== session.id),
            ])
          )
        );
        if (session.id === currentSessionId)
          resetCurrentSession(session.modeName, session.agentId ?? null);
      }
      throw new Error(
        deleted ? "대화는 삭제됐지만 목록을 갱신하지 못했습니다." : "대화를 삭제하지 못했습니다."
      );
    }
  };

  const saveOperationModeSettings = async (
    nextModes: Mode[],
    nextModeIcons: Record<Mode, ModeIcon>,
    nextSelectedMode: Mode,
    modeItems: OperationModeInput[]
  ) => {
    const nextModeProjectPaths = modeItems.reduce<Record<Mode, string[]>>((acc, mode) => {
      acc[mode.name] = mode.projectPaths || [];
      return acc;
    }, {});
    const nextModeDefaultModels = modeItems.reduce<Record<Mode, string>>((acc, mode) => {
      acc[mode.name] = mode.defaultModel?.trim() || LLM_CONFIG.model;
      return acc;
    }, {});

    let persisted = false;
    try {
      await persistOperationModes(modeItems, nextSelectedMode);
      persisted = true;
      onModesSaved(modeItems);
      const selectedItem = modeItems.find((item) => item.name === nextSelectedMode);
      const sameMode = selectedItem?.originalName === selectedMode;
      const [nextAgents, prepared] = await Promise.all([
        fetchAgentsForMode(nextSelectedMode),
        prepareModeSessions(
          nextSelectedMode,
          nextModes,
          sameMode ? currentAgentId : null,
          currentSessionId
        ),
      ]);
      setModes(nextModes);
      setModeIcons(nextModeIcons);
      setModeProjectPaths(nextModeProjectPaths);
      setModeDefaultModels(nextModeDefaultModels);
      setSelectedMode(nextSelectedMode);
      setAgents(nextAgents);
      applyPreparedSessions(prepared);
    } catch {
      if (persisted) {
        // 저장은 성공했으므로 삭제된 기존 세션을 계속 표시하지 않습니다.
        setModes(nextModes);
        setModeIcons(nextModeIcons);
        setModeProjectPaths(nextModeProjectPaths);
        setModeDefaultModels(nextModeDefaultModels);
        setSelectedMode(nextSelectedMode);
        setAgents([]);
        setSessionsByMode({});
        resetCurrentSession(nextSelectedMode, null);
      }
      throw new Error(
        persisted
          ? "모드는 저장됐지만 데이터를 다시 불러오지 못했습니다."
          : "모드 설정을 저장하지 못했습니다."
      );
    }
  };

  const getModeIcon = (mode: Mode): ModeIcon => {
    return modeIcons[mode] || MODE_ICON_OPTIONS[2];
  };

  const getModeProjectPaths = (mode: Mode) => {
    return modeProjectPaths[mode] || [];
  };

  const getModeDefaultModel = (mode: Mode) => {
    return modeDefaultModels[mode] || settings.model || LLM_CONFIG.model;
  };

  const updateCurrentSessionProjectPaths = async (projectPaths: string[]) => {
    if (!currentSessionId) {
      return;
    }

    const next = await invoke<SessionItem>("update_chat_session_project_paths", {
      input: {
        sessionId: currentSessionId,
        projectPaths,
      },
    });

    setCurrentSessionProjectPaths(next.projectPaths || []);
    await refreshSessions(modes, currentSessionId);
  };

  const openProjectFolder = async (path: string) => {
    await invoke("open_folder_in_explorer", { path });
  };

  const saveAgentsForSelectedMode = async (nextAgents: AgentItem[]) => {
    const normalizedAgents = normalizeAgentsForUi(
      nextAgents.map(({ status: _status, ...agent }) => {
        void _status;
        return {
          ...agent,
        };
      })
    );

    let persisted = false;
    try {
      await invoke("save_mode_agents", {
        modeName: selectedMode,
        agents: normalizedAgents.map(({ status: _status, ...agent }) => {
          void _status;
          return agent;
        }),
      });
      persisted = true;
      // 서버가 부여한 ID까지 다시 받아 다음 대화에서 동일 대상을 참조합니다.
      await loadAgentsForMode(selectedMode);
    } catch {
      if (persisted) setAgents([]);
      throw new Error(
        persisted
          ? "에이전트 설정은 저장됐지만 다시 불러오지 못했습니다."
          : "에이전트 설정을 저장하지 못했습니다."
      );
    }
  };

  return {
    getModeDefaultModel,
    getModeIcon,
    getModeProjectPaths,
    handleSessionDelete,
    handleSessionSelect,
    loadAgentsForMode,
    loadOperationModes,
    selectAgentConversation,
    refreshSessions,
    saveAgentsForSelectedMode,
    saveOperationModeSettings,
    selectOperationMode,
    updateCurrentSessionProjectPaths,
    openProjectFolder,
  };
}
