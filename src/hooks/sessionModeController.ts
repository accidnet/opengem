import { invoke } from "@tauri-apps/api/core";
import type { Dispatch, SetStateAction } from "react";

import { getChatSession } from "@/features/backend/api";
import { AGENTS, LLM_CONFIG, MODE_ICON_OPTIONS, MODES, type Mode, type ModeIcon } from "@/features/app/config/appData";
import type { AgentItem, LLMSettings, OperationModeState, SessionDetail, SessionItem } from "@/types/chat";

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

  const loadSession = async (sessionId: string, nextModes: ReadonlyArray<Mode> = modes) => {
    setIsSessionLoading(true);
    try {
      const detail = await getChatSession(sessionId);
      setCurrentSessionId(detail.session.id);
      setCurrentSessionTitle(detail.session.title);
      setCurrentSessionProjectPaths(detail.session.projectPaths || []);
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

  const loadOperationModes = async () => {
    let next: OperationModeState | null = null;

    try {
      next = await invoke<OperationModeState>("load_operation_mode");
      if (next.modes.length === 0) {
        return;
      }

      setModes(next.modes);
      setSelectedMode(next.selectedMode);
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

      setModeIcons((prev) => {
        const nextIcons = { ...prev };
        next.modes.forEach((mode, index) => {
          if (!nextIcons[mode]) {
            nextIcons[mode] = index === 0 ? "smart_toy" : "tune";
          }
        });
        return nextIcons;
      });
    } catch {
      setModes([...MODES]);
      setSelectedMode(MODES[0]);
      setModeProjectPaths({});
      setModeDefaultModels({});
      setAgents(normalizeAgentsForUi([...AGENTS]));
      setSessionsByMode({});
      return;
    }

    try {
      const nextAgents = await invoke<PersistedAgent[]>("load_mode_agents", {
        modeName: next.selectedMode,
      });
      setAgents(normalizeAgentsForUi(nextAgents));
    } catch {
      setAgents(normalizeAgentsForUi([...AGENTS]));
    }

    try {
      await syncModeSessions(next.selectedMode, next.modes, null);
    } catch {
      resetCurrentSession();
      void refreshSessions(next.modes, null);
    }
  };

  const persistOperationModes = async (nextModes: OperationModeInput[], nextSelectedMode: Mode) => {
    await invoke("save_operation_mode", {
      modes: nextModes,
      selectedMode: nextSelectedMode,
    });
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
      // 세션 선택 실패 시 현재 화면을 유지한다.
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
      // 세션 삭제 실패 시 현재 상태를 유지한다.
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
    const previousModeProjectPaths = modeProjectPaths;
    const previousModeDefaultModels = modeDefaultModels;
    const previousSelectedMode = selectedMode;
    const previousAgents = agents;
    const nextModeProjectPaths = modeItems.reduce<Record<Mode, string[]>>((acc, mode) => {
      acc[mode.name] = mode.projectPaths || [];
      return acc;
    }, {});
    const nextModeDefaultModels = modeItems.reduce<Record<Mode, string>>((acc, mode) => {
      acc[mode.name] = mode.defaultModel?.trim() || LLM_CONFIG.model;
      return acc;
    }, {});

    setModes(nextModes);
    setModeIcons(nextModeIcons);
    setModeProjectPaths(nextModeProjectPaths);
    setModeDefaultModels(nextModeDefaultModels);
    setSelectedMode(nextSelectedMode);

    try {
      await persistOperationModes(modeItems, nextSelectedMode);
      await loadAgentsForMode(nextSelectedMode);
      await syncModeSessions(nextSelectedMode, nextModes, null);
    } catch {
      setModes(previousModes);
      setModeIcons(previousModeIcons);
      setModeProjectPaths(previousModeProjectPaths);
      setModeDefaultModels(previousModeDefaultModels);
      setSelectedMode(previousSelectedMode);
      setAgents(previousAgents);
      void loadOperationModes();
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
    const previousAgents = agents;
    const normalizedAgents = normalizeAgentsForUi(
      nextAgents.map(({ status: _status, ...agent }) => {
        void _status;
        return {
          ...agent,
        };
      })
    );

    setAgents(normalizedAgents);

    try {
      await invoke("save_mode_agents", {
        modeName: selectedMode,
        agents: normalizedAgents.map(({ status: _status, ...agent }) => {
          void _status;
          return agent;
        }),
      });
    } catch {
      setAgents(previousAgents);
      throw new Error("에이전트 설정을 저장하지 못했습니다.");
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
