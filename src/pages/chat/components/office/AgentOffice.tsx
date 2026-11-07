import officeScene from "./office-background.svg";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import type { AgentItem } from "@/types/chat";

import "./AgentOffice.css";

type AgentOfficeProps = {
  agents: AgentItem[];
  selectedAgentIndex: number | null;
  onSelectAgent: (index: number) => void;
  onStartChat: (index: number) => void;
  isConversationBusy: boolean;
};

// 한 오피스에 네 자리를 두고, 인원이 늘면 다음 오피스를 이어서 표시합니다.
const DESK_POSITIONS = [18, 39.5, 61, 82.5];
const AGENTS_PER_ROOM = DESK_POSITIONS.length;

export function AgentOffice({
  agents,
  selectedAgentIndex,
  onSelectAgent,
  onStartChat,
  isConversationBusy,
}: AgentOfficeProps) {
  const roomCount = Math.max(1, Math.ceil(agents.length / AGENTS_PER_ROOM));

  return (
    <section className="agent-office" aria-label="에이전트 오피스">
      <div className="agent-office-head">
        <div className="agent-office-heading">
          <span aria-hidden="true">✳</span>
          <strong>우리 팀 오피스</strong>
          <span className="agent-office-count">{agents.length}명</span>
        </div>
        <span className="agent-office-label">WORKSPACE</span>
      </div>
      {Array.from({ length: roomCount }, (_, roomIndex) => (
        <div className="agent-office-scene" key={roomIndex}>
          <img src={officeScene} alt="" />
          {roomIndex === 0 && (
            <span className="agent-office-caption" aria-hidden="true">
              ✳ &nbsp; 우리 팀의 작업 공간
            </span>
          )}
          {agents
            .slice(roomIndex * AGENTS_PER_ROOM, (roomIndex + 1) * AGENTS_PER_ROOM)
            .map((agent, deskIndex) => {
              const index = roomIndex * AGENTS_PER_ROOM + deskIndex;
              return (
                <button
                  key={agent.agentId || index}
                  type="button"
                  className={
                    "agent-office-marker " + (selectedAgentIndex === index ? "is-selected" : "")
                  }
                  style={{ left: String(DESK_POSITIONS[deskIndex]) + "%" }}
                  aria-label={agent.name + "와 대화하기"}
                  title={
                    isConversationBusy
                      ? "응답이 끝난 뒤 대화를 전환할 수 있어요."
                      : agent.name + "와 대화하기"
                  }
                  disabled={isConversationBusy}
                  onClick={() => onStartChat(index)}
                >
                  <span className="agent-office-marker-label">
                    <span
                      className={"agent-office-marker-dot " + (agent.active ? "is-active" : "")}
                    />
                    <span className="agent-office-marker-name">{agent.name}</span>
                  </span>
                  <CharacterAvatar agent={agent} className="agent-office-person" />
                </button>
              );
            })}
        </div>
      ))}
      <div className="agent-office-foot">
        <span>
          우리 팀 <strong>{agents.length}</strong>명
        </span>
        <span>
          {isConversationBusy
            ? "응답이 끝나면 대화를 전환할 수 있어요"
            : "에이전트를 선택해 대화를 시작하세요"}
        </span>
      </div>
      {agents.length > 0 ? (
        <div className="agent-office-team" aria-label="에이전트 목록">
          {agents.map((agent, index) => (
            <div
              key={agent.agentId || index}
              className={"agent-office-card " + (selectedAgentIndex === index ? "is-selected" : "")}
            >
              <button
                type="button"
                className="agent-office-card-chat"
                aria-label={agent.name + "와 대화하기"}
                title={
                  isConversationBusy
                    ? "응답이 끝난 뒤 대화를 전환할 수 있어요."
                    : agent.name + "와 대화하기"
                }
                disabled={isConversationBusy}
                onClick={() => onStartChat(index)}
              >
                <span className={"agent-office-avatar agent-office-avatar-" + agent.color}>
                  <CharacterAvatar agent={agent} className="agent-character-avatar" />
                </span>
                <span className="agent-office-card-copy">
                  <strong>{agent.name}</strong>
                  <small>
                    {agent.role === "main"
                      ? "메인 에이전트"
                      : agent.role === "sub"
                        ? "보조 에이전트"
                        : "역할 미지정"}
                  </small>
                </span>
                <span className={"agent-office-state " + (agent.active ? "is-active" : "")}>
                  {agent.active ? "활성" : "비활성"}
                </span>
              </button>
              <button
                type="button"
                className="agent-office-info"
                aria-label={`${agent.name} 상세 정보`}
                aria-expanded={selectedAgentIndex === index}
                title={`${agent.name} 상세 정보`}
                onClick={() => onSelectAgent(index)}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  info
                </span>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="agent-office-empty">아직 등록된 에이전트가 없어요.</p>
      )}
    </section>
  );
}
