import { useEffect, useState, type KeyboardEvent } from "react";
import { IconBadge } from "@/components/IconBadge";
import type { AgentItem, SessionItem } from "@/types/chat";
import { MODE_ICON_OPTIONS, type Mode, type ModeIcon } from "@/data/appData";

type LeftPanelProps = {
  modes: readonly Mode[];
  selectedMode: Mode;
  onModeSelect: (mode: Mode) => void;
  onAddMode: (name: string, icon: ModeIcon) => void;
  onRemoveMode: (mode: Mode) => void;
  onMoveMode: (mode: Mode, direction: "up" | "down") => void;
  onRenameMode: (mode: Mode, nextName: string) => void;
  onChangeModeIcon: (mode: Mode, icon: ModeIcon) => void;
  onResetModes: () => void;
  getModeIcon: (mode: Mode) => ModeIcon;
  agents: AgentItem[];
  sessions: SessionItem[];
  tools: string[];
};

export function LeftPanel({
  modes,
  selectedMode,
  onModeSelect,
  onAddMode,
  onRemoveMode,
  onMoveMode,
  onRenameMode,
  onChangeModeIcon,
  onResetModes,
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

  useEffect(() => {
    if (!isModeSettingsOpen) {
      return;
    }

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsModeSettingsOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isModeSettingsOpen]);

  const handlePrimaryModeClick = () => {
    if (selectedMode !== modes[0]) {
      onModeSelect(modes[0]);
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

    const exists = modes.some((mode) => mode.toLowerCase() === trimmedName.toLowerCase());
    if (exists) {
      setModeNameError("이미 같은 이름의 모드가 있어.");
      return;
    }

    onAddMode(trimmedName, newModeIcon);
    setModeNameError("");
    setNewModeName("");
  };

  const handleCreateModeOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCreateMode();
    }
  };

  const handleRenameBlur = (mode: Mode, value: string) => {
    const trimmedValue = value.trim();
    if (!trimmedValue || trimmedValue === mode) {
      return;
    }

    const exists = modes.some(
      (modeName) => modeName !== mode && modeName.toLowerCase() === trimmedValue.toLowerCase()
    );
    if (exists) {
      return;
    }

    onRenameMode(mode, trimmedValue);
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
            onClick={() => setIsModeSettingsOpen(true)}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
              add
            </span>
          </button>
        </div>
        <div className="panel-list">
          <button
            type="button"
            className={`mode-btn ${selectedMode === modes[0] ? "is-active" : ""}`}
            onClick={handlePrimaryModeClick}
            aria-expanded={isPrimaryModeOpen}
            aria-controls="orchestrator-sub-sessions"
          >
            <div className="btn-side">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "20px", color: "#38bdf8" }}
              >
                smart_toy
              </span>
              <span>Orchestrator</span>
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
          onClick={() => setIsModeSettingsOpen(false)}
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
                <p className="mode-settings-description">
                  추가, 제거, 순서 변경, 아이콘 변경, 이름 수정까지 한 번에 관리할 수 있어.
                </p>
              </div>
              <button
                className="small-icon-btn"
                type="button"
                aria-label="설정 창 닫기"
                onClick={() => setIsModeSettingsOpen(false)}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                  close
                </span>
              </button>
            </header>

            <div className="mode-settings-create">
              <input
                type="text"
                className="mode-settings-input"
                placeholder="새 모드 이름"
                value={newModeName}
                onChange={(event) => {
                  setNewModeName(event.target.value);
                  if (modeNameError) {
                    setModeNameError("");
                  }
                }}
                onKeyDown={handleCreateModeOnEnter}
                aria-label="새 operation mode 이름"
              />
              <select
                className="mode-settings-select"
                value={newModeIcon}
                onChange={(event) => setNewModeIcon(event.target.value as ModeIcon)}
                aria-label="새 operation mode 아이콘"
              >
                {MODE_ICON_OPTIONS.map((iconName) => (
                  <option key={iconName} value={iconName}>
                    {iconName}
                  </option>
                ))}
              </select>
              <button className="mode-settings-action" type="button" onClick={handleCreateMode}>
                추가
              </button>
            </div>
            {modeNameError && <p className="mode-settings-error">{modeNameError}</p>}

            <div className="mode-settings-list" role="list" aria-label="Operation mode 목록">
              {modes.map((mode, index) => {
                const isProtectedMode = index === 0;
                return (
                  <div className="mode-settings-item" role="listitem" key={mode}>
                    <button
                      type="button"
                      className={`mode-settings-mode-btn ${selectedMode === mode ? "is-selected" : ""}`}
                      onClick={() => onModeSelect(mode)}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                        {getModeIcon(mode)}
                      </span>
                    </button>
                    <input
                      className="mode-settings-input"
                      defaultValue={mode}
                      disabled={isProtectedMode}
                      aria-label={`${mode} 이름 수정`}
                      onBlur={(event) => handleRenameBlur(mode, event.target.value)}
                    />
                    <select
                      className="mode-settings-select"
                      value={getModeIcon(mode)}
                      onChange={(event) => onChangeModeIcon(mode, event.target.value as ModeIcon)}
                      aria-label={`${mode} 아이콘 변경`}
                    >
                      {MODE_ICON_OPTIONS.map((iconName) => (
                        <option key={iconName} value={iconName}>
                          {iconName}
                        </option>
                      ))}
                    </select>
                    <button
                      className="small-icon-btn"
                      type="button"
                      title="위로 이동"
                      onClick={() => onMoveMode(mode, "up")}
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
                      onClick={() => onMoveMode(mode, "down")}
                      disabled={index === modes.length - 1 || isProtectedMode}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                        arrow_downward
                      </span>
                    </button>
                    <button
                      className="small-icon-btn danger"
                      type="button"
                      title="모드 제거"
                      onClick={() => onRemoveMode(mode)}
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
              <button className="mode-settings-sub-action" type="button" onClick={onResetModes}>
                기본 모드로 복원
              </button>
            </footer>
          </section>
        </div>
      )}
    </aside>
  );
}
