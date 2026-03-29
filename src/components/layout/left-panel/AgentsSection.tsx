import type { AgentItem } from "@/types/chat";

type AgentsSectionProps = {
  agents: AgentItem[];
  onOpenSettings: () => void;
};

export function AgentsSection({ agents, onOpenSettings }: AgentsSectionProps) {
  return (
    <section className="panel-block">
      <div className="section-head-with-action">
        <h3 className="section-title">Active Agents</h3>
        <button className="small-icon-btn" type="button" title="에이전트 설정" onClick={onOpenSettings}>
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
              <div className="agent-name-row">
                <p className="agent-name">{agent.name}</p>
                {agent.role === "main" && (
                  <span
                    className="material-symbols-outlined agent-main-badge"
                    title="메인 에이전트"
                    aria-label="메인 에이전트"
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
  );
}
