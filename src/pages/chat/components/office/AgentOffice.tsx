import officeScene from "./office-background.svg";
import type { AgentItem } from "@/types/chat";

import "./AgentOffice.css";

type AgentOfficeProps = {
  agents: AgentItem[];
  selectedAgentIndex: number | null;
  onSelectAgent: (index: number) => void;
};

// 한 오피스에 네 자리를 두고, 인원이 늘면 다음 오피스를 이어서 표시합니다.
const DESK_POSITIONS = [18, 39.5, 61, 82.5];
const AGENTS_PER_ROOM = DESK_POSITIONS.length;
const SHIRT_COLORS: Record<AgentItem["color"], string> = {
  indigo: "#90b7c7",
  emerald: "#97b7a1",
  amber: "#e3bd7f",
  violet: "#b5a6d3",
  rose: "#e9a69b",
};

export function AgentOffice({ agents, selectedAgentIndex, onSelectAgent }: AgentOfficeProps) {
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
                  key={index}
                  type="button"
                  className={
                    "agent-office-marker " + (selectedAgentIndex === index ? "is-selected" : "")
                  }
                  style={{ left: String(DESK_POSITIONS[deskIndex]) + "%" }}
                  aria-pressed={selectedAgentIndex === index}
                  aria-label={agent.name + " 에이전트 선택"}
                  title={agent.name}
                  onClick={() => onSelectAgent(index)}
                >
                  <span className="agent-office-marker-label">
                    <span
                      className={"agent-office-marker-dot " + (agent.active ? "is-active" : "")}
                    />
                    <span className="agent-office-marker-name">{agent.name}</span>
                  </span>
                  <svg
                    className="agent-office-person"
                    viewBox="0 0 54 68"
                    shapeRendering="crispEdges"
                    aria-hidden="true"
                  >
                    <rect x="8" y="48" width="15" height="15" fill="#706777" />
                    <rect x="30" y="48" width="15" height="15" fill="#706777" />
                    <rect x="6" y="61" width="17" height="7" fill="#605c69" />
                    <rect x="30" y="61" width="17" height="7" fill="#605c69" />
                    <rect x="4" y="28" width="46" height="23" fill={SHIRT_COLORS[agent.color]} />
                    <rect x="0" y="32" width="6" height="16" fill={SHIRT_COLORS[agent.color]} />
                    <rect x="48" y="32" width="6" height="16" fill={SHIRT_COLORS[agent.color]} />
                    <rect x="0" y="45" width="6" height="6" fill="#edbda8" />
                    <rect x="48" y="45" width="6" height="6" fill="#edbda8" />
                    <rect x="8" y="2" width="38" height="29" fill="#5d4c59" />
                    <rect x="12" y="9" width="30" height="20" fill="#edbda8" />
                    <rect x="8" y="4" width="38" height="7" fill="#5d4c59" />
                    <rect x="12" y="10" width="10" height="4" fill="#5d4c59" />
                    <rect x="16" y="17" width="3" height="3" fill="#544b54" />
                    <rect x="34" y="17" width="3" height="3" fill="#544b54" />
                    <rect x="23" y="23" width="8" height="2" fill="#cf8d84" />
                    <rect x="21" y="28" width="12" height="5" fill="#faf3ec" />
                  </svg>
                </button>
              );
            })}
        </div>
      ))}
      <div className="agent-office-foot">
        <span>
          우리 팀 <strong>{agents.length}</strong>명
        </span>
        <span>에이전트를 선택해 자세히 살펴보세요</span>
      </div>
      {agents.length > 0 ? (
        <div className="agent-office-team" aria-label="에이전트 목록">
          {agents.map((agent, index) => (
            <button
              key={index}
              type="button"
              className={"agent-office-card " + (selectedAgentIndex === index ? "is-selected" : "")}
              aria-pressed={selectedAgentIndex === index}
              onClick={() => onSelectAgent(index)}
            >
              <span className={"agent-office-avatar agent-office-avatar-" + agent.color}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  {agent.icon}
                </span>
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
          ))}
        </div>
      ) : (
        <p className="agent-office-empty">아직 등록된 에이전트가 없어요.</p>
      )}
    </section>
  );
}
