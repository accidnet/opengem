import type { MouseEvent } from "react";

import { CharacterAvatar } from "@/components/CharacterAvatar";
import type { AgentItem, AgentRole } from "@/types/chat";

type QuickEditAgentDraft = {
  name: string;
  model: string;
  role: AgentRole;
  active: boolean;
};

type AgentsSectionProps = {
  agents: AgentItem[];
  onAgentChat: (agent: AgentItem) => void;
  currentAgentId: string | null;
  onOpenSettings: () => void;
  quickEditAgentIndex: number | null;
  quickEditDraft: QuickEditAgentDraft | null;
  quickEditError: string;
  onStartQuickEditAgent: (index: number, anchorRect: DOMRect) => void;
  onQuickEditAgentChange: <K extends keyof QuickEditAgentDraft>(
    key: K,
    value: QuickEditAgentDraft[K]
  ) => void;
};

export function AgentsSection({
  agents,
  onAgentChat,
  currentAgentId,
  onOpenSettings,
  quickEditAgentIndex,
  quickEditDraft,
  onStartQuickEditAgent,
}: AgentsSectionProps) {
  return (
    <section className="panel-block">
      <div className="section-head-with-action">
        <h3 className="section-title">Active Agents</h3>
        <button
          className="small-icon-btn"
          type="button"
          title="에이전트 설정"
          onClick={onOpenSettings}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
            add
          </span>
        </button>
      </div>
      <div className="panel-list">
        {agents.map((agent, index) => {
          const isEditing = quickEditAgentIndex === index && quickEditDraft;
          const isCurrent = Boolean(agent.agentId && agent.agentId === currentAgentId);

          return (
            <div
              key={agent.agentId || index}
              className={"agent-entry-shell " + (isEditing ? "is-editing" : "")}
            >
              <div
                className="agent-entry"
                style={isCurrent ? { background: "#3d3a55" } : undefined}
              >
                <div className={"agent-dot " + agent.color}>
                  <CharacterAvatar agent={agent} className="agent-character-avatar" />
                  <span
                    className={"status-dot status-dot-" + (agent.active ? "active" : "idle")}
                    title={agent.active ? "활성" : "대기"}
                  />
                </div>
                <div className="agent-copy">
                  <div className="agent-name-row">
                    <button
                      type="button"
                      className="agent-name"
                      aria-current={isCurrent ? "true" : undefined}
                      title={agent.name + "와 대화"}
                      onClick={() => onAgentChat(agent)}
                      style={{
                        background: "transparent",
                        border: 0,
                        padding: 0,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      {agent.name}
                    </button>
                    {isCurrent && <span className="agent-chat-status">대화 중</span>}
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
                  <p className="agent-model">{agent.model?.trim() || "기본 모델 없음"}</p>
                  <p className={"agent-state " + (agent.active ? "agent-state-active" : "")}>
                    {agent.status}
                  </p>
                </div>
                <button
                  className="small-icon-btn agent-entry-menu-btn"
                  type="button"
                  title="에이전트 빠른 설정"
                  aria-label={agent.name + " 빠른 설정"}
                  onClick={(event: MouseEvent<HTMLButtonElement>) =>
                    onStartQuickEditAgent(index, event.currentTarget.getBoundingClientRect())
                  }
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                    more_horiz
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
