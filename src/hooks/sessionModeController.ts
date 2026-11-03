import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Dispatch, SetStateAction } from "react";

import { getChatSession } from "@/features/backend/api";
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
  agents: AgentItem[];
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
  restoreDraft: (session: SessionItem) => void;
  setCurrentSessionProjectPaths: Setter<string[]>;
  setCurrentSessionTitle: Setter<string>;
  setIsSessionLoading: Setter<boolean>;
  setMessages: Setter<SessionDetail["messages"]>;
  setModeDefaultModels: Setter<Record<Mode, string>>;
  setModeIcons: Setter<Record<Mode, ModeIcon>>;
  setModeProjectPaths: Setter<Record<Mode, string[]>>;
  setModes: Setter<Mode[]>;
  setSelectedMode: Setter<Mode>;
  setSessionsByMode: Setter<Record<Mode, SessionItem[]>>;
  resetCurrentSession: () => void;
};

export function createSessionModeController({
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
  restoreDraft,
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

  const loadSession = async (sessionId: string, nextModes: ReadonlyArray<Mode> = modes) => {
    setIsSessionLoading(true);
    try {
      // 모든 조회가 성공한 뒤에만 세션과 목록을 함께 반영합니다.
      const [detail, nextSessions] = await Promise.all([
        getChatSession(sessionId),
        invoke<SessionItem[]>("list_chat_sessions"),
      ]);
      applySessionDetail(detail);
      applySessionList(nextSessions, nextModes, detail.session.id);
    } finally {
      setIsSessionLoading(false);
    }
  };

  const prepareModeSessions = async (
    mode: Mode,
    nextModes: ReadonlyArray<Mode>,
    preferredSessionId?: string | null
  ) => {
    const nextSessions = await invoke<SessionItem[]>("list_chat_sessions");
    const modeSessions = nextSessions.filter((session) => session.modeName === mode);
    const candidateSessionId =
      preferredSessionId && modeSessions.some((session) => session.id === preferredSessionId)
        ? preferredSessionId
        : modeSessions[0]?.id;

    const detail = candidateSessionId ? await getChatSession(candidateSessionId) : null;
    return { nextSessions, nextModes, detail };
  };

  const applyPreparedSessions = (prepared: Awaited<ReturnType<typeof prepareModeSessions>>) => {
    if (prepared.detail) {
      applySessionDetail(prepared.detail);
    } else {
      resetCurrentSession();
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
        prepareModeSessions(next.selectedMode, next.modes, null),
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
        resetCurrentSession();
        throw new Error("저장된 작업 공간을 불러오지 못했습니다. 앱을 다시 열어 주세요.");
      }
      setModes([...MODES]);
      setSelectedMode(MODES[0]);
      setModeProjectPaths({});
      setModeDefaultModels({});
      setAgents(normalizeAgentsForUi([...AGENTS]));
      setSessionsByMode({});
      resetCurrentSession();
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
      const [nextAgents, prepared] = await Promise.all([
        fetchAgentsForMode(mode),
        prepareModeSessions(mode, modes, null),
      ]);
      await invoke("select_operation_mode", { selectedMode: mode });
      setSelectedMode(mode);
      setAgents(nextAgents);
      applyPreparedSessions(prepared);
    } catch {
      throw new Error("작업 모드를 불러오지 못했습니다.");
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

      const sameModeSessions = nextSessions.filter((item) => item.modeName === session.modeName);
      const fallbackSession = sameModeSessions[0];
      const changingMode = session.modeName !== selectedMode;
      const [detail, nextAgents] = await Promise.all([
        fallbackSession ? getChatSession(fallbackSession.id) : Promise.resolve(null),
        changingMode ? fetchAgentsForMode(session.modeName) : Promise.resolve(null),
      ]);
      if (changingMode) {
        await invoke("select_operation_mode", { selectedMode: session.modeName });
        setSelectedMode(session.modeName);
        if (nextAgents) setAgents(nextAgents);
      }
      if (detail) applySessionDetail(detail);
      else resetCurrentSession();
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
        if (session.id === currentSessionId) resetCurrentSession();
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
      const [nextAgents, prepared] = await Promise.all([
        fetchAgentsForMode(nextSelectedMode),
        prepareModeSessions(nextSelectedMode, nextModes, null),
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
        resetCurrentSession();
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
    loadSession,
    refreshSessions,
    saveAgentsForSelectedMode,
    saveOperationModeSettings,
    selectOperationMode,
    updateCurrentSessionProjectPaths,
    openProjectFolder,
  };
}
