import { useEffect, useState, type MouseEvent } from "react";

import { CharacterAvatar } from "@/components/CharacterAvatar";
import type { AgentItem, AgentRole, SessionItem } from "@/types/chat";
import { SessionList } from "./SessionList";

type QuickEditAgentDraft = {
  name: string;
  model: string;
  role: AgentRole;
  active: boolean;
};

type AgentsSectionProps = {
  agents: AgentItem[];
  agentSessions: SessionItem[];
  onAgentChat: (agent: AgentItem) => void;
  onNewAgentChat: (agent: AgentItem) => void;
  onSessionSelect: (session: SessionItem) => void | Promise<void>;
  onSessionDelete: (session: SessionItem) => void | Promise<void>;
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
  agentSessions,
  onAgentChat,
  onNewAgentChat,
  onSessionSelect,
  onSessionDelete,
  currentAgentId,
  onOpenSettings,
  quickEditAgentIndex,
  quickEditDraft,
  onStartQuickEditAgent,
}: AgentsSectionProps) {
  const [expandedAgentId, setExpandedAgentId] = useState(currentAgentId);
  const agentIds = new Set(agents.map((agent) => agent.agentId));
  const deletedAgentSessions = agentSessions.filter(
    (session) => session.agentId && !agentIds.has(session.agentId)
  );

  // 오피스나 상세 패널에서 개인 대화를 열어도 왼쪽에 같은 에이전트의 기록을 표시합니다.
  useEffect(() => {
    if (currentAgentId) setExpandedAgentId(currentAgentId);
  }, [currentAgentId]);

  return (
    <section className="panel-block" aria-labelledby="active-agents-label">
      <div className="section-head-with-action">
        <h3 id="active-agents-label" className="section-title">
          Active Agents
        </h3>
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
          const isExpanded = Boolean(agent.agentId && agent.agentId === expandedAgentId);
          const listId = `agent-sub-sessions-${index}`;

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
                      onClick={() => {
                        setExpandedAgentId(agent.agentId ?? null);
                        onAgentChat(agent);
                      }}
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
                <div className="agent-entry-actions">
                  <button
                    className="small-icon-btn"
                    type="button"
                    title="에이전트 빠른 설정"
                    aria-label={agent.name + " 빠른 설정"}
                    onClick={(event: MouseEvent<HTMLButtonElement>) =>
                      onStartQuickEditAgent(index, event.currentTarget.getBoundingClientRect())
                    }
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">
                      more_horiz
                    </span>
                  </button>
                  {agent.agentId && (
                    <button
                      className="small-icon-btn"
                      type="button"
                      title={`${agent.name} 대화 목록`}
                      aria-label={`${agent.name} 대화 목록`}
                      aria-controls={listId}
                      aria-expanded={isExpanded}
                      onClick={() =>
                        setExpandedAgentId(isExpanded ? null : (agent.agentId ?? null))
                      }
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">
                        {isExpanded ? "expand_less" : "expand_more"}
                      </span>
                    </button>
                  )}
                </div>
              </div>
              {agent.agentId && (
                <SessionList
                  id={listId}
                  label={`${agent.name} 대화 목록`}
                  isOpen={isExpanded}
                  sessions={agentSessions.filter((session) => session.agentId === agent.agentId)}
                  onSessionSelect={onSessionSelect}
                  onSessionDelete={onSessionDelete}
                >
                  <button
                    className="agent-session-new"
                    type="button"
                    aria-label={`${agent.name} 새 대화`}
                    disabled={!agent.active}
                    title={
                      agent.active ? undefined : "에이전트를 활성화하면 새 대화를 시작할 수 있어요."
                    }
                    onClick={() => onNewAgentChat(agent)}
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">
                      add
                    </span>
                    새 대화
                  </button>
                </SessionList>
              )}
            </div>
          );
        })}
        {deletedAgentSessions.length > 0 && (
          <div className="mode-group">
            <h4 className="deleted-agent-heading">삭제된 에이전트</h4>
            <SessionList
              label="삭제된 에이전트 대화 목록"
              isOpen
              sessions={deletedAgentSessions}
              onSessionSelect={onSessionSelect}
              onSessionDelete={onSessionDelete}
            />
          </div>
        )}
      </div>
    </section>
  );
}
