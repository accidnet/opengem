import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Dispatch, SetStateAction } from "react";

import { getChatSession } from "@/features/backend/api";
import { sessionsForTarget } from "@/pages/chat/conversationTarget";
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
  restoreDraft: (session: SessionItem) => void;
  hasUnsentDraft: (mode: Mode, agentId: string | null) => boolean;
  setCurrentSessionProjectPaths: Setter<string[]>;
  setCurrentSessionTitle: Setter<string>;
  setMessages: Setter<SessionDetail["messages"]>;
  setModeDefaultModels: Setter<Record<Mode, string>>;
  setModeIcons: Setter<Record<Mode, ModeIcon>>;
  setModeProjectPaths: Setter<Record<Mode, string[]>>;
  setModes: Setter<Mode[]>;
  setSelectedMode: Setter<Mode>;
  setSessionsByMode: Setter<Record<Mode, SessionItem[]>>;
  resetCurrentSession: (agentId?: string | null, mode?: Mode) => void;
};

export function createSessionModeController({
  agents,
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
  restoreDraft,
  hasUnsentDraft,
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
    agentId: string | null = null,
    preferredSessionId?: string | null
  ) => {
    const nextSessions = await invoke<SessionItem[]>("list_chat_sessions");
    const sessions = sessionsForTarget(nextSessions, mode, agentId);
    // 설정을 저장할 때 새 대화에 작성 중이던 초안도 현재 선택으로 유지합니다.
    const keepCurrentDraft = preferredSessionId === null;
    const resumeDraft = preferredSessionId === undefined && hasUnsentDraft(mode, agentId);
    const candidate =
      keepCurrentDraft || resumeDraft
        ? null
        : (sessions.find((session) => session.id === preferredSessionId) ?? sessions[0]);
    const detail = candidate ? await getChatSession(candidate.id) : null;
    return { mode, agentId, nextSessions, detail, keepCurrentDraft };
  };

  const applyPreparedSessions = (
    prepared: Awaited<ReturnType<typeof prepareModeSessions>>,
    nextModes: ReadonlyArray<Mode>
  ) => {
    if (prepared.detail) {
      applySessionDetail(prepared.detail);
    } else if (!prepared.keepCurrentDraft) {
      resetCurrentSession(prepared.agentId, prepared.mode);
    }
    applySessionList(prepared.nextSessions, nextModes, prepared.detail?.session.id ?? null);
  };

  const openAgentSessions = async (agentId: string) => {
    const prepared = await prepareModeSessions(selectedMode, agentId);
    applyPreparedSessions(prepared, modes);
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
        prepareModeSessions(next.selectedMode),
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
      applyPreparedSessions(prepared, loadedModes);
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
        prepareModeSessions(mode),
      ]);
      await invoke("select_operation_mode", { selectedMode: mode });
      setSelectedMode(mode);
      setAgents(nextAgents);
      applyPreparedSessions(prepared, modes);
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
    const agentId = session.agentId ?? null;
    const remainingAgentId = agents.some((agent) => agent.agentId === agentId) ? agentId : null;
    try {
      await invoke("delete_chat_session", { sessionId: session.id });
      deleted = true;

      const nextSessions = await invoke<SessionItem[]>("list_chat_sessions");
      if (session.id !== currentSessionId) {
        applySessionList(nextSessions, modes, currentSessionId);
        return;
      }

      const fallbackSession = sessionsForTarget(nextSessions, session.modeName, agentId)[0];
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
      else resetCurrentSession(remainingAgentId, session.modeName);
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
          resetCurrentSession(remainingAgentId, session.modeName);
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
      const selectedItem = modeItems.find((mode) => mode.name === nextSelectedMode);
      const keepCurrent = selectedItem?.originalName === selectedMode;
      const [nextAgents, prepared] = await Promise.all([
        fetchAgentsForMode(nextSelectedMode),
        prepareModeSessions(
          nextSelectedMode,
          keepCurrent ? currentAgentId : null,
          keepCurrent ? currentSessionId : undefined
        ),
      ]);
      setModes(nextModes);
      setModeIcons(nextModeIcons);
      setModeProjectPaths(nextModeProjectPaths);
      setModeDefaultModels(nextModeDefaultModels);
      setSelectedMode(nextSelectedMode);
      setAgents(nextAgents);
      applyPreparedSessions(prepared, nextModes);
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
        resetCurrentSession(null, nextSelectedMode);
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
    openAgentSessions,
    refreshSessions,
    saveAgentsForSelectedMode,
    saveOperationModeSettings,
    selectOperationMode,
    updateCurrentSessionProjectPaths,
    openProjectFolder,
  };
}
