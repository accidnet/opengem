import { useState } from "react";
import { IconBadge } from "@/components/IconBadge";
import type { AgentItem, SessionItem } from "@/types/chat";
import type { Mode } from "@/data/appData";

type LeftPanelProps = {
  modes: readonly Mode[];
  selectedMode: Mode;
  onModeSelect: (mode: Mode) => void;
  agents: AgentItem[];
  sessions: SessionItem[];
  tools: string[];
};

export function LeftPanel({
  modes,
  selectedMode,
  onModeSelect,
  agents,
  sessions,
  tools,
}: LeftPanelProps) {
  const [isPrimaryModeOpen, setIsPrimaryModeOpen] = useState(true);

  const handlePrimaryModeClick = () => {
    if (selectedMode !== modes[0]) {
      onModeSelect(modes[0]);
      setIsPrimaryModeOpen(true);
      return;
    }

    setIsPrimaryModeOpen((prev) => !prev);
  };

  return (
    <aside className="left-panel">
      <section className="panel-block">
        <div className="section-head-with-action">
          <h3 className="section-title">Operation Mode</h3>
          <button className="new-session-btn new-session-btn-small" type="button">
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
              add
            </span>
            Session
          </button>
        </div>
        <div className="mode-card">
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
        </div>

        <div className="mode-list">
          {modes.slice(1).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`mode-btn ${selectedMode === mode ? "is-active" : ""}`}
              onClick={() => onModeSelect(mode)}
            >
              <div className="btn-side">
                <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
                  {mode === "Dev Mode" ? "terminal" : "tune"}
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
        <div className="agent-stack">
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
        <div className="tool-list">
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
    </aside>
  );
}
