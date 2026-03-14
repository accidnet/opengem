import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconBadge } from "@/components/IconBadge";
import type { AgentColor, AgentItem, AgentRole, SessionItem } from "@/types/chat";
import { MODE_ICON_OPTIONS, type Mode, type ModeIcon } from "@/data/appData";
import { formatSessionTime } from "@/utils/chat";

type DraftModeItem = {
  id: string;
  name: string;
  icon: ModeIcon;
  originalName?: Mode;
};

type DraftAgentItem = AgentItem & {
  id: string;
};

type AgentSettingsTab = "create" | "list";

const MODE_ICON_LABELS: Record<ModeIcon, string> = {
  smart_toy: "스마트 토이",
  terminal: "터미널",
  tune: "커스텀",
  bolt: "볼트",
  build: "빌드",
  settings: "설정",
  rocket_launch: "런치",
  integration_instructions: "연동",
};

const AGENT_COLOR_OPTIONS: AgentColor[] = ["indigo", "emerald", "amber", "violet", "rose"];

const AGENT_COLOR_LABELS: Record<AgentColor, string> = {
  indigo: "인디고",
  emerald: "에메랄드",
  amber: "앰버",
  violet: "바이올렛",
  rose: "로즈",
};

const AGENT_ICON_OPTIONS = [
  "account_tree",
  "travel_explore",
  "code",
  "design_services",
  "database",
  "smart_toy",
  "terminal",
  "rocket_launch",
] as const;

const DEFAULT_AGENT_MODEL = "gpt-5.4";

const parseConfigList = (value: string) => {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
};

type LeftPanelProps = {
  modes: readonly Mode[];
  selectedMode: Mode;
  openSelectedModeSignal: number;
  onModeSelect: (mode: Mode) => void | Promise<void>;
  onSaveModeSettings: (
    nextModes: Mode[],
    nextModeIcons: Record<Mode, ModeIcon>,
    nextSelectedMode: Mode,
    modeItems: Array<{ name: Mode; originalName?: Mode }>
  ) => void | Promise<void>;
  onSaveAgents: (nextAgents: AgentItem[]) => void | Promise<void>;
  getModeIcon: (mode: Mode) => ModeIcon;
  agents: AgentItem[];
  sessionsByMode: Record<Mode, SessionItem[]>;
  onSessionSelect: (session: SessionItem) => void | Promise<void>;
  tools: string[];
};

export function LeftPanel({
  modes,
  selectedMode,
  openSelectedModeSignal,
  onModeSelect,
  onSaveModeSettings,
  onSaveAgents,
  getModeIcon,
  agents,
  sessionsByMode,
  onSessionSelect,
  tools,
}: LeftPanelProps) {
  const [openModes, setOpenModes] = useState<Record<Mode, boolean>>({});
  const [isModeSettingsOpen, setIsModeSettingsOpen] = useState(false);
  const [isAgentSettingsOpen, setIsAgentSettingsOpen] = useState(false);
  const [agentSettingsTab, setAgentSettingsTab] = useState<AgentSettingsTab>("create");
  const [newModeName, setNewModeName] = useState("");
  const [newModeIcon, setNewModeIcon] = useState<ModeIcon>("tune");
  const [modeNameError, setModeNameError] = useState("");
  const [draftModes, setDraftModes] = useState<DraftModeItem[]>([]);
  const [draftAgents, setDraftAgents] = useState<DraftAgentItem[]>([]);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentIcon, setNewAgentIcon] =
    useState<(typeof AGENT_ICON_OPTIONS)[number]>("smart_toy");
  const [newAgentColor, setNewAgentColor] = useState<AgentColor>("indigo");
  const [newAgentModel, setNewAgentModel] = useState(DEFAULT_AGENT_MODEL);
  const [newAgentPrompt, setNewAgentPrompt] = useState("");
  const [newAgentTools, setNewAgentTools] = useState("");
  const [newAgentMcpServers, setNewAgentMcpServers] = useState("");
  const [newAgentSkills, setNewAgentSkills] = useState("");
  const [agentNameError, setAgentNameError] = useState("");
  const suppressOverlayCloseRef = useRef(false);
  const draftModeIdRef = useRef(0);
  const draftAgentIdRef = useRef(0);
  const isSettingsOpen = isModeSettingsOpen || isAgentSettingsOpen;

  // 토스트 알림 상태
  const [toastMessage, setToastMessage] = useState("");
  const [toastKind, setToastKind] = useState<"error" | "success" | "info">("error");
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (message: string, kind: "error" | "success" | "info" = "error") => {
      // 기존 타이머가 있으면 초기화
      if (toastTimerRef.current !== null) {
        clearTimeout(toastTimerRef.current);
      }
      setToastMessage(message);
      setToastKind(kind);
      setToastVisible(true);
      toastTimerRef.current = setTimeout(() => {
        setToastVisible(false);
        toastTimerRef.current = null;
      }, 3500);
    },
    []
  );

  useEffect(() => {
    setOpenModes((prev) => {
      const next = { ...prev };
      modes.forEach((mode) => {
        if (next[mode] === undefined) {
          next[mode] = mode === selectedMode;
        }
      });

      Object.keys(next).forEach((mode) => {
        if (!modes.includes(mode)) {
          delete next[mode];
        }
      });

      return next;
    });
  }, [modes, selectedMode]);

  useEffect(() => {
    setOpenModes((prev) => ({
      ...prev,
      [selectedMode]: true,
    }));
  }, [openSelectedModeSignal, selectedMode]);

  const openModeSettings = () => {
    setDraftModes(
      modes.map((mode, index) => ({
        id: `saved-${index}-${mode}`,
        name: mode,
        icon: getModeIcon(mode),
        originalName: mode,
      }))
    );
    setNewModeName("");
    setNewModeIcon("tune");
    setModeNameError("");
    setIsModeSettingsOpen(true);
  };

  const closeModeSettings = () => {
    setIsModeSettingsOpen(false);
  };

  const openAgentSettings = () => {
    setDraftAgents(
      agents.map((agent, index) => ({ ...agent, id: `saved-agent-${index}-${agent.name}` }))
    );
    setAgentSettingsTab("create");
    setNewAgentName("");
    setNewAgentIcon("smart_toy");
    setNewAgentColor("indigo");
    setNewAgentModel(DEFAULT_AGENT_MODEL);
    setNewAgentPrompt("");
    setNewAgentTools("");
    setNewAgentMcpServers("");
    setNewAgentSkills("");
    setAgentNameError("");
    setIsAgentSettingsOpen(true);
  };

  const closeAgentSettings = () => {
    setIsAgentSettingsOpen(false);
  };

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isAgentSettingsOpen) {
          closeAgentSettings();
          return;
        }

        closeModeSettings();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isAgentSettingsOpen, isSettingsOpen]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    const handleMouseUp = () => {
      window.setTimeout(() => {
        suppressOverlayCloseRef.current = false;
      }, 0);
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [isSettingsOpen]);

  const toggleModeOpen = (mode: Mode) => {
    setOpenModes((prev) => ({
      ...prev,
      [mode]: !prev[mode],
    }));
  };

  const handleModeClick = (mode: Mode) => {
    const isSelected = selectedMode === mode;
    if (!isSelected) {
      void onModeSelect(mode);
      setOpenModes((prev) => ({
        ...prev,
        [mode]: true,
      }));
      return;
    }

    toggleModeOpen(mode);
  };

  const handleCreateMode = () => {
    const trimmedName = newModeName.trim();
    if (!trimmedName) {
      setModeNameError("모드 이름을 입력해줘.");
      return;
    }

    const exists = draftModes.some(
      (mode) => mode.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (exists) {
      setModeNameError("이미 같은 이름의 모드가 있어.");
      return;
    }

    draftModeIdRef.current += 1;
    setDraftModes((prev) => [
      ...prev,
      {
        id: `draft-${draftModeIdRef.current}`,
        name: trimmedName,
        icon: newModeIcon,
      },
    ]);
    setModeNameError("");
    setNewModeName("");
    setNewModeIcon("tune");
  };

  const handleCreateModeOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCreateMode();
    }
  };

  const handleDraftModeNameChange = (id: string, value: string) => {
    setDraftModes((prev) => prev.map((mode) => (mode.id === id ? { ...mode, name: value } : mode)));
    if (modeNameError) {
      setModeNameError("");
    }
  };

  const handleDraftModeIconChange = (id: string, icon: ModeIcon) => {
    setDraftModes((prev) => prev.map((mode) => (mode.id === id ? { ...mode, icon } : mode)));
  };

  const handleCreateAgent = () => {
    const trimmedName = newAgentName.trim();
    if (!trimmedName) {
      setAgentNameError("에이전트 이름을 입력해줘.");
      return;
    }

    const exists = draftAgents.some(
      (agent) => agent.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (exists) {
      setAgentNameError("이미 같은 이름의 에이전트가 있어.");
      return;
    }

    // 이미 main 에이전트가 있으면 sub, 없으면 자동으로 main 설정
    const hasMain = draftAgents.some((a) => a.role === "main");
    draftAgentIdRef.current += 1;
    setDraftAgents((prev) => [
      ...prev,
      {
        id: `draft-agent-${draftAgentIdRef.current}`,
        name: trimmedName,
        icon: newAgentIcon,
        color: newAgentColor,
        role: (hasMain ? "sub" : "main") as AgentRole,
        model: newAgentModel.trim() || DEFAULT_AGENT_MODEL,
        prompt: newAgentPrompt.trim(),
        tools: parseConfigList(newAgentTools),
        mcpServers: parseConfigList(newAgentMcpServers),
        skills: parseConfigList(newAgentSkills),
        status: "대기 중",
        active: true,
      },
    ]);
    setAgentNameError("");
    setNewAgentName("");
    setNewAgentIcon("smart_toy");
    setNewAgentColor("indigo");
    setNewAgentModel(DEFAULT_AGENT_MODEL);
    setNewAgentPrompt("");
    setNewAgentTools("");
    setNewAgentMcpServers("");
    setNewAgentSkills("");
    setAgentSettingsTab("list");
  };

  const handleCreateAgentOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCreateAgent();
    }
  };

  const handleDraftAgentChange = <K extends keyof DraftAgentItem>(
    id: string,
    key: K,
    value: DraftAgentItem[K]
  ) => {
    setDraftAgents((prev) =>
      prev.map((agent) => (agent.id === id ? { ...agent, [key]: value } : agent))
    );
    if (key === "name" && agentNameError) {
      setAgentNameError("");
    }
  };

  const handleRemoveDraftAgent = (id: string) => {
    setDraftAgents((prev) => {
      const filtered = prev.filter((agent) => agent.id !== id);
      // 삭제 후 main이 사라지면 첫 번째 에이전트를 main으로 승격
      const hasMain = filtered.some((a) => a.role === "main");
      if (!hasMain && filtered.length > 0) {
        return filtered.map((a, idx) => (idx === 0 ? { ...a, role: "main" as AgentRole } : a));
      }
      return filtered;
    });
  };

  /** 특정 에이전트를 main으로 설정하고 나머지는 sub로 변경 */
  const handleSetMainAgent = (id: string) => {
    setDraftAgents((prev) =>
      prev.map((agent) => ({
        ...agent,
        role: (agent.id === id ? "main" : "sub") as AgentRole,
      }))
    );
  };

  const handleMoveDraftAgent = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= draftAgents.length) {
      return;
    }

    setDraftAgents((prev) => {
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const handleAgentSettingsOverlayClick = () => {
    if (suppressOverlayCloseRef.current) {
      suppressOverlayCloseRef.current = false;
      return;
    }

    closeAgentSettings();
  };

  const handleSaveAgentSettings = async () => {
    const normalizedAgents = draftAgents.map((agent, index) => ({
      name: agent.name.trim(),
      icon: agent.icon,
      status: agent.status,
      color: agent.color,
      active: agent.active,
      // role이 없으면 첫 번째를 main, 나머지를 sub로 기본 설정
      role: (agent.role ?? (index === 0 ? "main" : "sub")) as AgentRole,
      model: agent.model?.trim() || DEFAULT_AGENT_MODEL,
      prompt: agent.prompt?.trim() || "",
      tools: agent.tools || [],
      mcpServers: agent.mcpServers || [],
      skills: agent.skills || [],
    }));

    if (normalizedAgents.some((agent) => !agent.name)) {
      setAgentNameError("에이전트 이름을 비워둘 수 없어.");
      return;
    }

    const normalizedNames = normalizedAgents.map((agent) => agent.name.toLowerCase());
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      setAgentNameError("이미 같은 이름의 에이전트가 있어.");
      return;
    }

    // role 정규화: main이 없으면 첫 번째를 main으로 승격
    const hasMainAgent = normalizedAgents.some((a) => a.role === "main");
    if (!hasMainAgent && normalizedAgents.length > 0) {
      normalizedAgents[0].role = "main";
    }

    try {
      await onSaveAgents(normalizedAgents);
      closeAgentSettings();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
      showToast(reason, "error");
    }
  };

  const handleMoveDraftMode = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex <= 0 || targetIndex >= draftModes.length) {
      return;
    }

    setDraftModes((prev) => {
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const handleRemoveDraftMode = (id: string) => {
    setDraftModes((prev) => prev.filter((mode) => mode.id !== id));
  };

  const handleResetDraftModes = () => {
    setDraftModes([
      {
        id: "saved-0-Orchestration",
        name: "Orchestration",
        icon: "smart_toy",
        originalName: modes[0] || "Orchestration",
      },
    ]);
    setNewModeName("");
    setNewModeIcon("tune");
    setModeNameError("");
  };

  const getModeIconLabel = (icon: ModeIcon) => {
    return MODE_ICON_LABELS[icon] || icon;
  };

  const handleModeSettingsOverlayClick = () => {
    if (suppressOverlayCloseRef.current) {
      suppressOverlayCloseRef.current = false;
      return;
    }

    closeModeSettings();
  };

  const handleSaveModeSettings = async () => {
    const normalizedModes = draftModes.map((mode) => ({
      ...mode,
      name: mode.name.trim(),
    }));

    if (normalizedModes.length === 0) {
      setModeNameError("최소 한 개의 모드는 필요해.");
      return;
    }

    if (normalizedModes.some((mode) => !mode.name)) {
      setModeNameError("모드 이름을 비워둘 수 없어.");
      return;
    }

    const normalizedNames = normalizedModes.map((mode) => mode.name.toLowerCase());
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      setModeNameError("이미 같은 이름의 모드가 있어.");
      return;
    }

    const nextModes = normalizedModes.map((mode) => mode.name);
    const modeItems = normalizedModes.map((mode) => ({
      name: mode.name,
      originalName: mode.originalName,
    }));
    const nextModeIcons = normalizedModes.reduce<Record<Mode, ModeIcon>>((acc, mode, index) => {
      acc[mode.name] = mode.icon || (index === 0 ? "smart_toy" : "tune");
      return acc;
    }, {});
    const selectedDraftMode = normalizedModes.find((mode) => mode.originalName === selectedMode);
    const nextSelectedMode = selectedDraftMode?.name || nextModes[0];

    await onSaveModeSettings(nextModes, nextModeIcons, nextSelectedMode, modeItems);
    closeModeSettings();
  };

  return (
    <>
    <aside className="left-panel">
      <section className="panel-block">
        <div className="section-head-with-action">
          <h3 className="section-title">Operation Mode</h3>
          <button
            className="small-icon-btn"
            type="button"
            title="모드 설정"
            onClick={openModeSettings}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
              add
            </span>
          </button>
        </div>
        <div className="panel-list">
          {modes.map((mode, index) => {
            const modeSessions = sessionsByMode[mode] || [];
            const isOpen = openModes[mode] ?? mode === selectedMode;
            const sessionListId = `mode-sub-sessions-${index}`;

            return (
              <div key={mode} className="mode-group">
                <button
                  type="button"
                  className={`mode-btn ${selectedMode === mode ? "is-active" : ""}`}
                  onClick={() => handleModeClick(mode)}
                  aria-expanded={isOpen}
                  aria-controls={sessionListId}
                >
                  <div className="btn-side">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "20px", color: index === 0 ? "#38bdf8" : undefined }}
                    >
                      {getModeIcon(mode)}
                    </span>
                    <span>{mode}</span>
                  </div>
                  <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                    {isOpen ? "expand_less" : "expand_more"}
                  </span>
                </button>

                <div
                  id={sessionListId}
                  className={`sub-session-list ${isOpen ? "is-open" : ""}`}
                  aria-hidden={!isOpen}
                >
                  {modeSessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className={`session-row ${session.active ? "session-row-active" : ""}`}
                      tabIndex={isOpen ? 0 : -1}
                      onClick={() => onSessionSelect(session)}
                    >
                      <span>{session.title}</span>
                      <span>{formatSessionTime(session.updatedAt)}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel-block">
        <div className="section-head-with-action">
          <h3 className="section-title">Active Agents</h3>
          <button
            className="small-icon-btn"
            type="button"
            title="에이전트 설정"
            onClick={openAgentSettings}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
              add
            </span>
          </button>
        </div>
        <div className="panel-list">
          {agents.map((agent) => (
            <div key={agent.name} className="agent-entry">
              <div className={`agent-dot ${agent.color}`}>
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                  {agent.icon}
                </span>
                <span
                  className={`status-dot status-dot-${agent.active ? "active" : "idle"}`}
                  title={agent.active ? "활성" : "대기"}
                />
              </div>
              <div className="agent-copy">
                <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                  <p className="agent-name">{agent.name}</p>
                  {agent.role === "main" && (
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: "11px", color: "#fbbf24" }}
                      title="메인 에이전트 (채팅 수신 대상)"
                    >
                      star
                    </span>
                  )}
                </div>
                <p className={`agent-state ${agent.active ? "agent-state-active" : ""}`}>
                  {agent.status}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel-block">
        <h3 className="section-title">Enabled Tools</h3>
        <div className="panel-list">
          {tools.map((tool) => (
            <div key={tool} className="tool-item">
              <IconBadge
                icon={
                  tool === "웹 브라우저"
                    ? "public"
                    : tool === "Python Repl"
                      ? "terminal"
                      : "folder_open"
                }
              />
              <span className="tool-label">{tool}</span>
            </div>
          ))}
        </div>
      </section>

      {isModeSettingsOpen && (
        <div
          className="mode-settings-overlay"
          role="presentation"
          onClick={handleModeSettingsOverlayClick}
        >
          <section
            className="mode-settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mode-settings-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="mode-settings-header">
              <div>
                <h4 id="mode-settings-title" className="mode-settings-title">
                  Operation Mode 설정
                </h4>
              </div>
              <button
                className="small-icon-btn"
                type="button"
                aria-label="설정 창 닫기"
                onClick={closeModeSettings}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                  close
                </span>
              </button>
            </header>

            <div className="mode-settings-create">
              <div className="mode-settings-mode-btn is-selected" aria-hidden="true">
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                  {newModeIcon}
                </span>
              </div>
              <input
                type="text"
                className="mode-settings-input"
                placeholder="새 모드 이름"
                value={newModeName}
                onMouseDown={() => {
                  suppressOverlayCloseRef.current = true;
                }}
                onChange={(event) => {
                  setNewModeName(event.target.value);
                  if (modeNameError) {
                    setModeNameError("");
                  }
                }}
                onKeyDown={handleCreateModeOnEnter}
                aria-label="새 operation mode 이름"
              />
              <div className="mode-settings-select-wrap">
                <select
                  className="mode-settings-select"
                  value={newModeIcon}
                  onChange={(event) => setNewModeIcon(event.target.value as ModeIcon)}
                  aria-label="새 operation mode 아이콘"
                >
                  {MODE_ICON_OPTIONS.map((iconName) => (
                    <option key={iconName} value={iconName}>
                      {getModeIconLabel(iconName)}
                    </option>
                  ))}
                </select>
              </div>
              <button className="mode-settings-action" type="button" onClick={handleCreateMode}>
                추가
              </button>
            </div>
            {modeNameError && <p className="mode-settings-error">{modeNameError}</p>}

            <div className="mode-settings-list" role="list" aria-label="Operation mode 목록">
              {draftModes.map((mode, index) => {
                const isProtectedMode = index === 0;
                return (
                  <div className="mode-settings-item" role="listitem" key={mode.id}>
                    <div className="mode-settings-mode-btn" aria-hidden="true">
                      <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                        {mode.icon}
                      </span>
                    </div>
                    <input
                      className="mode-settings-input"
                      value={mode.name}
                      aria-label={`${mode.name || "mode"} 이름 수정`}
                      onMouseDown={() => {
                        suppressOverlayCloseRef.current = true;
                      }}
                      onChange={(event) => handleDraftModeNameChange(mode.id, event.target.value)}
                    />
                    <div className="mode-settings-select-wrap">
                      <select
                        className="mode-settings-select"
                        value={mode.icon}
                        onChange={(event) =>
                          handleDraftModeIconChange(mode.id, event.target.value as ModeIcon)
                        }
                        aria-label={`${mode.name || "mode"} 아이콘 변경`}
                      >
                        {MODE_ICON_OPTIONS.map((iconName) => (
                          <option key={iconName} value={iconName}>
                            {getModeIconLabel(iconName)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      className="small-icon-btn"
                      type="button"
                      title="위로 이동"
                      onClick={() => handleMoveDraftMode(index, "up")}
                      disabled={isProtectedMode || index === 1}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                        arrow_upward
                      </span>
                    </button>
                    <button
                      className="small-icon-btn"
                      type="button"
                      title="아래로 이동"
                      onClick={() => handleMoveDraftMode(index, "down")}
                      disabled={index === draftModes.length - 1 || isProtectedMode}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                        arrow_downward
                      </span>
                    </button>
                    <button
                      className="small-icon-btn danger"
                      type="button"
                      title="모드 제거"
                      onClick={() => handleRemoveDraftMode(mode.id)}
                      disabled={isProtectedMode}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                        delete
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>

            <footer className="mode-settings-footer">
              <button
                className="mode-settings-sub-action"
                type="button"
                onClick={handleResetDraftModes}
              >
                기본 모드로 복원
              </button>
              <button
                className="mode-settings-action"
                type="button"
                onClick={handleSaveModeSettings}
              >
                저장
              </button>
            </footer>
          </section>
        </div>
      )}

      {isAgentSettingsOpen && (
        <div
          className="settings-overlay"
          role="presentation"
          onClick={handleAgentSettingsOverlayClick}
        >
          <section
            className="provider-modal agent-provider-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-settings-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="provider-header">
              <div className="provider-header-title-wrap">
                <span className="provider-header-icon material-symbols-outlined" aria-hidden="true">
                  hub
                </span>
                <h3 id="agent-settings-title" className="settings-title">
                  Agents
                </h3>
              </div>
              <button
                className="provider-close-btn"
                type="button"
                aria-label="에이전트 설정 창 닫기"
                onClick={closeAgentSettings}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  close
                </span>
              </button>
            </header>

            <div className="provider-body">
              <aside className="provider-sidebar agent-provider-sidebar" aria-label="agent 설정 탭">
                <p className="provider-sidebar-label">AGENTS</p>
                <p className="provider-sidebar-help">에이전트를 추가하고 순서를 관리해.</p>

                <button
                  className={`provider-nav-item ${agentSettingsTab === "create" ? "is-active" : ""}`}
                  type="button"
                  aria-current={agentSettingsTab === "create" ? "true" : undefined}
                  onClick={() => setAgentSettingsTab("create")}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    person_add
                  </span>
                  <span>Agent 추가</span>
                </button>
                <button
                  className={`provider-nav-item ${agentSettingsTab === "list" ? "is-active" : ""}`}
                  type="button"
                  aria-current={agentSettingsTab === "list" ? "true" : undefined}
                  onClick={() => setAgentSettingsTab("list")}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    format_list_bulleted
                  </span>
                  <span>Agent 목록</span>
                </button>
              </aside>

              <main className="provider-main agent-provider-main">
                {agentSettingsTab === "create" ? (
                  <>
                    <div className="provider-main-copy">
                      <h4>Agent 추가</h4>
                      <p>
                        기본 정보와 모델, 프롬프트, 연결 리소스를 함께 설정해 새 에이전트를 만들어.
                      </p>
                    </div>

                    <section className="settings-card agent-create-card">
                      <div className="settings-card-head settings-card-head-column">
                        <div>
                          <h4>기본 설정</h4>
                          <p>이름, 아이콘, 색상을 정하면 좌측 Active Agents에 바로 반영돼.</p>
                        </div>
                      </div>

                      <label className="settings-field">
                        <span>에이전트 이름</span>
                        <input
                          className="settings-input"
                          type="text"
                          placeholder="새 에이전트 이름"
                          value={newAgentName}
                          onMouseDown={() => {
                            suppressOverlayCloseRef.current = true;
                          }}
                          onChange={(event) => {
                            setNewAgentName(event.target.value);
                            if (agentNameError) {
                              setAgentNameError("");
                            }
                          }}
                          onKeyDown={handleCreateAgentOnEnter}
                          aria-label="새 에이전트 이름"
                        />
                      </label>

                      <label className="settings-field">
                        <span>아이콘</span>
                        <select
                          className="settings-input"
                          value={newAgentIcon}
                          onChange={(event) =>
                            setNewAgentIcon(
                              event.target.value as (typeof AGENT_ICON_OPTIONS)[number]
                            )
                          }
                          aria-label="새 에이전트 아이콘"
                        >
                          {AGENT_ICON_OPTIONS.map((iconName) => (
                            <option key={iconName} value={iconName}>
                              {iconName}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="settings-field">
                        <span>색상</span>
                        <select
                          className="settings-input"
                          value={newAgentColor}
                          onChange={(event) => setNewAgentColor(event.target.value as AgentColor)}
                          aria-label="새 에이전트 색상"
                        >
                          {AGENT_COLOR_OPTIONS.map((colorName) => (
                            <option key={colorName} value={colorName}>
                              {AGENT_COLOR_LABELS[colorName]}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="settings-field settings-field-wide">
                        <span>모델</span>
                        <input
                          className="settings-input"
                          type="text"
                          placeholder="gpt-5.4"
                          value={newAgentModel}
                          onChange={(event) => setNewAgentModel(event.target.value)}
                          aria-label="새 에이전트 모델"
                        />
                      </label>
                    </section>

                    <section className="settings-card agent-config-card">
                      <div className="settings-card-head settings-card-head-column">
                        <div>
                          <h4>작업 컨텍스트</h4>
                          <p>프롬프트와 연결 항목은 줄바꿈이나 쉼표로 여러 개 입력할 수 있어.</p>
                        </div>
                      </div>

                      <label className="settings-field settings-field-wide">
                        <span>프롬프트 설정</span>
                        <textarea
                          className="settings-input settings-textarea"
                          rows={5}
                          placeholder="이 에이전트가 맡을 역할과 작업 방식을 적어줘"
                          value={newAgentPrompt}
                          onChange={(event) => setNewAgentPrompt(event.target.value)}
                          aria-label="새 에이전트 프롬프트 설정"
                        />
                      </label>

                      <label className="settings-field">
                        <span>Tools</span>
                        <textarea
                          className="settings-input settings-textarea settings-textarea-compact"
                          rows={4}
                          placeholder="웹 브라우저&#10;파일 시스템"
                          value={newAgentTools}
                          onChange={(event) => setNewAgentTools(event.target.value)}
                          aria-label="새 에이전트 tool 설정"
                        />
                      </label>

                      <label className="settings-field">
                        <span>MCP</span>
                        <textarea
                          className="settings-input settings-textarea settings-textarea-compact"
                          rows={4}
                          placeholder="github&#10;postgres"
                          value={newAgentMcpServers}
                          onChange={(event) => setNewAgentMcpServers(event.target.value)}
                          aria-label="새 에이전트 MCP 설정"
                        />
                      </label>

                      <label className="settings-field">
                        <span>Skill</span>
                        <textarea
                          className="settings-input settings-textarea settings-textarea-compact"
                          rows={4}
                          placeholder="design-review&#10;api-design"
                          value={newAgentSkills}
                          onChange={(event) => setNewAgentSkills(event.target.value)}
                          aria-label="새 에이전트 skill 설정"
                        />
                      </label>
                    </section>

                    {agentNameError && <p className="settings-error">{agentNameError}</p>}
                  </>
                ) : (
                  <>
                    <div className="provider-main-copy">
                      <h4>Agent 목록</h4>
                      <p>
                        순서 변경, 삭제, 그리고 각 에이전트의 이름과 아이콘을 바로 정리할 수 있어.
                      </p>
                    </div>

                    <section className="settings-card agent-list-card">
                      <div className="settings-card-head">
                        <div>
                          <h4>현재 에이전트</h4>
                          <p>총 {draftAgents.length}개 에이전트</p>
                        </div>
                      </div>

                      <div
                        className="mode-settings-list agent-settings-list"
                        role="list"
                        aria-label="Active agents 목록"
                      >
                        {draftAgents.map((agent, index) => (
                          <div
                            className="mode-settings-item agent-settings-item"
                            role="listitem"
                            key={agent.id}
                          >
                            <div className={`agent-dot ${agent.color}`} aria-hidden="true">
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: "16px" }}
                              >
                                {agent.icon}
                              </span>
                            </div>
                            <input
                              className="mode-settings-input"
                              value={agent.name}
                              aria-label={`${agent.name || "agent"} 이름 수정`}
                              onMouseDown={() => {
                                suppressOverlayCloseRef.current = true;
                              }}
                              onChange={(event) =>
                                handleDraftAgentChange(agent.id, "name", event.target.value)
                              }
                            />
                            <div className="mode-settings-select-wrap">
                              <select
                                className="mode-settings-select"
                                value={agent.icon}
                                onChange={(event) =>
                                  handleDraftAgentChange(agent.id, "icon", event.target.value)
                                }
                                aria-label={`${agent.name || "agent"} 아이콘 변경`}
                              >
                                {AGENT_ICON_OPTIONS.map((iconName) => (
                                  <option key={iconName} value={iconName}>
                                    {iconName}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="mode-settings-select-wrap">
                              <select
                                className="mode-settings-select"
                                value={agent.color}
                                onChange={(event) =>
                                  handleDraftAgentChange(
                                    agent.id,
                                    "color",
                                    event.target.value as AgentColor
                                  )
                                }
                                aria-label={`${agent.name || "agent"} 색상 변경`}
                              >
                                {AGENT_COLOR_OPTIONS.map((colorName) => (
                                  <option key={colorName} value={colorName}>
                                    {AGENT_COLOR_LABELS[colorName]}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <button
                              className="small-icon-btn"
                              type="button"
                              title={
                                agent.role === "main"
                                  ? "메인 에이전트 (채팅 수신 대상)"
                                  : "메인 에이전트로 설정"
                              }
                              disabled={agent.role === "main"}
                              onClick={() => handleSetMainAgent(agent.id)}
                              style={{ color: agent.role === "main" ? "#fbbf24" : undefined }}
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: "16px" }}
                              >
                                {agent.role === "main" ? "star" : "star_border"}
                              </span>
                            </button>
                            <button
                              className="small-icon-btn"
                              type="button"
                              title="위로 이동"
                              onClick={() => handleMoveDraftAgent(index, "up")}
                              disabled={index === 0}
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: "16px" }}
                              >
                                arrow_upward
                              </span>
                            </button>
                            <button
                              className="small-icon-btn"
                              type="button"
                              title="아래로 이동"
                              onClick={() => handleMoveDraftAgent(index, "down")}
                              disabled={index === draftAgents.length - 1}
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: "16px" }}
                              >
                                arrow_downward
                              </span>
                            </button>
                            <button
                              className="small-icon-btn danger"
                              type="button"
                              title="에이전트 제거"
                              onClick={() => handleRemoveDraftAgent(agent.id)}
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: "16px" }}
                              >
                                delete
                              </span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>

                    {agentNameError && <p className="settings-error">{agentNameError}</p>}
                  </>
                )}
              </main>
            </div>

            <footer className="settings-footer agent-settings-footer">
              <button className="settings-secondary-btn" type="button" onClick={closeAgentSettings}>
                Cancel
              </button>
              <div className="agent-settings-footer-actions">
                {agentSettingsTab === "create" && (
                  <button
                    className="settings-secondary-btn"
                    type="button"
                    onClick={handleCreateAgent}
                  >
                    Agent 추가
                  </button>
                )}
                <button
                  className="settings-primary-btn"
                  type="button"
                  onClick={handleSaveAgentSettings}
                >
                  Done
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </aside>

      {toastVisible && (
        <div className="toast-container" role="alert" aria-live="assertive">
          <div className={`toast is-${toastKind}`}>
            <span className="toast-icon material-symbols-outlined" aria-hidden="true">
              {toastKind === "error"
                ? "error"
                : toastKind === "success"
                  ? "check_circle"
                  : "info"}
            </span>
            <span>{toastMessage}</span>
          </div>
        </div>
      )}
    </>
  );
}
