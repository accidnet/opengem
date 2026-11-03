import type { ActivityItem, ActivityState, AgentItem } from "@/types/chat";

import "./AgentDetailPanel.css";

type AgentDetailPanelProps = {
  agent: AgentItem;
  activity: ActivityItem[];
  onClose: () => void;
};

const activityLabels: Record<ActivityState, string> = {
  done: "완료",
  active: "진행 중",
  working: "작업 중",
  pending: "대기 중",
  failed: "실패",
};

export function AgentDetailPanel({ agent, activity, onClose }: AgentDetailPanelProps) {
  // 활동은 현재 세션의 메시지에서 만들어지므로 에이전트 이름으로 연결합니다.
  const agentActivity = activity
    .filter((item) => item.source === agent.name)
    .slice(-3)
    .reverse();
  const capabilities = [
    { label: "도구", values: agent.tools },
    { label: "MCP", values: agent.mcpServers },
    { label: "스킬", values: agent.skills },
  ].filter((item) => item.values && item.values.length > 0);

  return (
    <aside className="right-panel agent-detail" aria-label={`${agent.name} 상세 정보`}>
      <div className="agent-detail-topline">
        <span>AGENT PROFILE</span>
        <button type="button" onClick={onClose} aria-label="에이전트 선택 해제">
          <span className="material-symbols-outlined" aria-hidden="true">
            close
          </span>
        </button>
      </div>

      <div className="agent-detail-profile">
        <div className={`agent-detail-avatar agent-detail-avatar--${agent.color}`}>
          <span className="material-symbols-outlined" aria-hidden="true">
            {agent.icon}
          </span>
        </div>
        <div className="agent-detail-identity">
          <h3>{agent.name}</h3>
          <p>
            {agent.role === "main"
              ? "메인 에이전트"
              : agent.role === "sub"
                ? "보조 에이전트"
                : "역할 미지정"}
          </p>
        </div>
      </div>

      <div className="agent-detail-facts">
        <div>
          <span>설정 상태</span>
          <strong>
            <i className={agent.active ? "is-active" : ""} />
            {agent.active ? "활성" : "비활성"}
          </strong>
        </div>
        <div>
          <span>모델</span>
          <strong>{agent.model?.trim() || "기본 모델"}</strong>
        </div>
      </div>

      {capabilities.length > 0 && (
        <div className="agent-detail-section">
          <h4>사용 설정</h4>
          {capabilities.map(({ label, values }) => (
            <div className="agent-detail-capability" key={label}>
              <span>{label}</span>
              <p>{values?.join(", ")}</p>
            </div>
          ))}
        </div>
      )}

      <div className="agent-detail-section">
        <h4>현재 채팅의 활동</h4>
        {agentActivity.length > 0 ? (
          <ul className="agent-detail-activity">
            {agentActivity.map((item) => (
              <li key={item.id}>
                <div>
                  <span className={`agent-detail-state agent-detail-state--${item.state}`}>
                    {activityLabels[item.state]}
                  </span>
                  {item.byline && <time>{item.byline}</time>}
                </div>
                <p>{item.text}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="agent-detail-empty">이 채팅에 기록된 활동이 없어요.</p>
        )}
      </div>
    </aside>
  );
}
