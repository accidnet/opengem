import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconBadge } from "@/components/IconBadge";
import type { AgentItem, SessionItem } from "@/types/chat";
import { MODE_ICON_OPTIONS, type Mode, type ModeIcon } from "@/data/appData";

type DraftModeItem = {
  id: string;
  name: string;
  icon: ModeIcon;
  originalName?: Mode;
};

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

type LeftPanelProps = {
  modes: readonly Mode[];
  selectedMode: Mode;
  onModeSelect: (mode: Mode) => void | Promise<void>;
  onSaveModeSettings: (
    nextModes: Mode[],
    nextModeIcons: Record<Mode, ModeIcon>,
    nextSelectedMode: Mode
  ) => void | Promise<void>;
  getModeIcon: (mode: Mode) => ModeIcon;
  agents: AgentItem[];
  sessions: SessionItem[];
  tools: string[];
};

export function LeftPanel({
  modes,
  selectedMode,
  onModeSelect,
  onSaveModeSettings,
  getModeIcon,
  agents,
  sessions,
  tools,
}: LeftPanelProps) {
  const [isPrimaryModeOpen, setIsPrimaryModeOpen] = useState(true);
  const [isModeSettingsOpen, setIsModeSettingsOpen] = useState(false);
  const [newModeName, setNewModeName] = useState("");
  const [newModeIcon, setNewModeIcon] = useState<ModeIcon>("tune");
  const [modeNameError, setModeNameError] = useState("");
  const [draftModes, setDraftModes] = useState<DraftModeItem[]>([]);
  const suppressOverlayCloseRef = useRef(false);
  const draftModeIdRef = useRef(0);
  const primaryMode = modes[0] || "Orchestrator";

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

  useEffect(() => {
    if (!isModeSettingsOpen) {
      return;
    }

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModeSettings();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isModeSettingsOpen]);

  useEffect(() => {
    if (!isModeSettingsOpen) {
      return;
    }

    const handleMouseUp = () => {
      window.setTimeout(() => {
        suppressOverlayCloseRef.current = false;
      }, 0);
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [isModeSettingsOpen]);

  const handlePrimaryModeClick = () => {
    if (selectedMode !== primaryMode) {
      onModeSelect(primaryMode);
      setIsPrimaryModeOpen(true);
      return;
    }

    setIsPrimaryModeOpen((prev) => !prev);
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
        id: "saved-0-Orchestrator",
        name: "Orchestrator",
        icon: "smart_toy",
        originalName: primaryMode,
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
    const nextModeIcons = normalizedModes.reduce<Record<Mode, ModeIcon>>((acc, mode, index) => {
      acc[mode.name] = mode.icon || (index === 0 ? "smart_toy" : "tune");
      return acc;
    }, {});
    const selectedDraftMode = normalizedModes.find((mode) => mode.originalName === selectedMode);
    const nextSelectedMode = selectedDraftMode?.name || nextModes[0];

    await onSaveModeSettings(nextModes, nextModeIcons, nextSelectedMode);
    closeModeSettings();
  };

  return (
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
          <button
            type="button"
            className={`mode-btn ${selectedMode === primaryMode ? "is-active" : ""}`}
            onClick={handlePrimaryModeClick}
            aria-expanded={isPrimaryModeOpen}
            aria-controls="orchestrator-sub-sessions"
          >
            <div className="btn-side">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "20px", color: "#38bdf8" }}
              >
                {getModeIcon(primaryMode)}
              </span>
              <span>{primaryMode}</span>
            </div>
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
              {isPrimaryModeOpen ? "expand_less" : "expand_more"}
            </span>
          </button>
          <div
            id="orchestrator-sub-sessions"
            className={`sub-session-list ${isPrimaryModeOpen ? "is-open" : ""}`}
            aria-hidden={!isPrimaryModeOpen}
          >
            {sessions.map((session) => (
              <button
                key={session.name}
                type="button"
                className={`session-row ${session.active ? "session-row-active" : ""}`}
                tabIndex={isPrimaryModeOpen ? 0 : -1}
              >
                <span>{session.name}</span>
                <span>{session.time}</span>
              </button>
            ))}
          </div>
          {modes.slice(1).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`mode-btn ${selectedMode === mode ? "is-active" : ""}`}
              onClick={() => onModeSelect(mode)}
            >
              <div className="btn-side">
                <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
                  {getModeIcon(mode)}
                </span>
                <span>{mode}</span>
              </div>
              <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                expand_more
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel-block">
        <div className="section-head-with-action">
          <h3 className="section-title">Active Agents</h3>
          <button className="small-icon-btn" type="button">
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
                <p className="agent-name">{agent.name}</p>
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
    </aside>
  );
}
