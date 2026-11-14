import { lazy, Suspense, useRef, useState } from "react";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import type { AgentItem } from "@/types/chat";
import type { OfficeViewportHandle } from "./OfficeViewport";
import { getOfficeAgentId } from "./office-identity";
import { OfficeIcon } from "./OfficeIcon";
import "./AgentOffice.css";

const OfficeViewport = lazy(() => import("./OfficeViewport"));

type AgentOfficeProps = {
  agents: AgentItem[];
  selectedAgentIndex: number | null;
  onSelectAgent: (index: number) => void;
  onStartChat: (index: number) => void;
  isConversationBusy: boolean;
};

export function AgentOffice({
  agents,
  selectedAgentIndex,
  onSelectAgent,
  onStartChat,
  isConversationBusy,
}: AgentOfficeProps) {
  // 이동 대상을 상세 패널 선택과 분리해 오피스 안에서 계속 조작합니다.
  const [controlledId, setControlledId] = useState<string | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const viewport = useRef<OfficeViewportHandle>(null);
  const index = agents.findIndex((agent, i) => getOfficeAgentId(agent, i) === controlledId);
  const selected = agents[index];
  const selectAgent = (id: string | null) => {
    setControlledId(id);
    if (id) viewport.current?.focus();
  };

  return (
    <section className="agent-office" aria-label="에이전트 오피스">
      <header className="office-header">
        <div className="office-title">
          <span className="office-brand-mark" aria-hidden="true">
            ✳
          </span>
          <div>
            <span className="office-eyebrow">OPENGEM WORKSPACE</span>
            <h2>우리 팀의 작은 오피스</h2>
          </div>
        </div>
        <span className="office-live">
          <i /> {agents.length}명의 팀원
        </span>
      </header>
      <div className="office-stage">
        <Suspense
          fallback={
            <div className="office-loading" role="status">
              3D 오피스를 준비하고 있어요…
            </div>
          }
        >
          <OfficeViewport
            ref={viewport}
            agents={agents}
            selectedId={selected ? controlledId : null}
            onSelect={selectAgent}
            onReady={setSceneReady}
          />
        </Suspense>
        <div className="office-scene-badge" aria-hidden="true">
          <i /> TEAM STUDIO <span>01</span>
        </div>
        <div className="office-camera-tools" aria-label="카메라 조작">
          <button
            type="button"
            title="확대"
            aria-label="확대"
            disabled={!sceneReady}
            onClick={() => viewport.current?.zoom(1.2)}
          >
            +
          </button>
          <button
            type="button"
            title="축소"
            aria-label="축소"
            disabled={!sceneReady}
            onClick={() => viewport.current?.zoom(1 / 1.2)}
          >
            −
          </button>
          <button
            type="button"
            title="시점 초기화"
            aria-label="시점 초기화"
            disabled={!sceneReady}
            onClick={() => viewport.current?.resetView()}
          >
            <OfficeIcon name="focus" />
          </button>
        </div>
        {sceneReady && (
          <div className="office-scene-hint">
            드래그로 둘러보기 <span>·</span> 휠로 확대
          </div>
        )}
      </div>
      <div className={"office-control-bar " + (selected ? "has-selection" : "")} aria-live="polite">
        {selected ? (
          <>
            <CharacterAvatar agent={selected} className="office-selected-avatar" />
            <div className="office-control-copy">
              <strong>{selected.name}</strong>
              <span>
                {sceneReady
                  ? "선택한 에이전트를 움직여 보세요"
                  : "대화와 상세 정보를 이용할 수 있어요"}
              </span>
            </div>
            <div className="office-selected-actions">
              <button
                type="button"
                className="office-chat-button"
                disabled={isConversationBusy}
                title={isConversationBusy ? "응답이 끝난 뒤 대화를 전환할 수 있어요" : undefined}
                aria-label={selected.name + "와 대화하기"}
                onClick={() => onStartChat(index)}
              >
                <OfficeIcon name="chat" />
                대화하기
              </button>
              <button
                type="button"
                className="office-icon-button"
                aria-label={selected.name + " 상세 정보"}
                title="상세 정보"
                aria-expanded={selectedAgentIndex === index}
                onClick={() => onSelectAgent(index)}
              >
                <OfficeIcon name="info" />
              </button>
              <button
                type="button"
                className="office-icon-button"
                aria-label="자리로 돌아가기"
                title="자리로 돌아가기"
                disabled={!sceneReady}
                onClick={() => {
                  viewport.current?.resetPosition();
                  viewport.current?.focus();
                }}
              >
                <OfficeIcon name="home" />
              </button>
              <button
                type="button"
                className="office-icon-button"
                aria-label="선택 해제"
                title="선택 해제"
                onClick={() => selectAgent(null)}
              >
                ×
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="office-pointer">
              <OfficeIcon name="pointer" />
            </span>
            <div className="office-control-copy">
              <strong>
                {agents.length
                  ? "팀원을 클릭하고, 자유롭게 걸어보세요"
                  : "새로운 팀원을 기다리는 중이에요"}
              </strong>
              <span>
                {agents.length
                  ? "오피스 또는 아래 목록에서 에이전트를 선택하세요"
                  : "왼쪽 에이전트 메뉴에서 팀원을 추가해 주세요"}
              </span>
            </div>
          </>
        )}
      </div>
      <div className="office-keyboard-guide" aria-label="오피스 조작 안내">
        <span>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> / <kbd>↑</kbd>
          <kbd>←</kbd>
          <kbd>↓</kbd>
          <kbd>→</kbd> 이동
        </span>
        <span>
          <kbd>Shift</kbd> 빠르게 <kbd>Esc</kbd> 선택 해제
        </span>
      </div>
      {agents.length > 0 && (
        <div className="office-roster" aria-label="에이전트 목록">
          {agents.map((agent, i) => {
            const id = getOfficeAgentId(agent, i);
            return (
              <button
                type="button"
                className={"office-agent-card " + (controlledId === id ? "is-selected" : "")}
                key={id}
                aria-label={agent.name + " 선택"}
                aria-pressed={controlledId === id}
                onClick={() => selectAgent(id)}
              >
                <span className={"office-card-avatar office-color-" + agent.color}>
                  <CharacterAvatar agent={agent} className="agent-character-avatar" />
                </span>
                <span className="office-card-copy">
                  <strong>{agent.name}</strong>
                  <small>
                    {agent.role === "main"
                      ? "메인 에이전트"
                      : agent.role === "sub"
                        ? "보조 에이전트"
                        : "팀 에이전트"}
                  </small>
                </span>
                <span
                  className={"office-status-dot " + (agent.active ? "is-active" : "")}
                  title={agent.active ? "활성" : "비활성"}
                />
              </button>
            );
          })}
        </div>
      )}
      {isConversationBusy && (
        <p className="office-busy-note">응답이 끝나면 다른 에이전트와 대화를 시작할 수 있어요.</p>
      )}
    </section>
  );
}
