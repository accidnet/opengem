import { useState } from "react";
import { AgentWorkspacePanel } from "@/components/AgentWorkspacePanel";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { getErrorMessage } from "@/features/app/appHelpers";
import type { ActivityItem, ActivityState, AgentItem } from "@/types/chat";

import "./AgentDetailPanel.css";

type AgentDetailPanelProps = {
  agent: AgentItem;
  modeName?: string;
  onOpenEmailSettings?: () => void;
  initialWorkspaceTab?: "memory" | "routines" | "reports";
  activity: ActivityItem[];
  onClose: () => void;
  onStartChat: () => void;
  onSavePrompt: (prompt: string) => Promise<void>;
  isConversationBusy: boolean;
};

const activityLabels: Record<ActivityState, string> = {
  done: "완료",
  active: "진행 중",
  working: "작업 중",
  pending: "대기 중",
  failed: "실패",
};

function AgentPromptEditor({
  prompt,
  onSave,
  busy,
}: {
  prompt: string;
  onSave: (prompt: string) => Promise<void>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(prompt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(draft.trim());
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="agent-detail-section agent-detail-prompt">
      <label htmlFor="agent-detail-prompt">프롬프트</label>
      <textarea
        id="agent-detail-prompt"
        className="settings-input"
        rows={3}
        value={draft}
        disabled={saving}
        onChange={(event) => {
          setDraft(event.target.value);
          setError("");
        }}
      />
      <button
        type="button"
        className="settings-secondary-btn"
        disabled={busy || saving || draft.trim() === prompt}
        title={busy && !saving ? "진행 중인 작업이 끝나면 저장할 수 있어요." : undefined}
        onClick={() => void save()}
      >
        {saving ? "저장 중…" : "저장"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function AgentDetailPanel({
  agent,
  modeName,
  onOpenEmailSettings,
  initialWorkspaceTab,
  activity,
  onClose,
  onStartChat,
  onSavePrompt,
  isConversationBusy,
}: AgentDetailPanelProps) {
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
          <CharacterAvatar agent={agent} className="agent-character-avatar" />
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

      <button
        className="agent-detail-chat"
        type="button"
        disabled={isConversationBusy}
        title={
          isConversationBusy
            ? "응답이 끝난 뒤 대화를 전환할 수 있어요."
            : `${agent.name}와 대화하기`
        }
        onClick={onStartChat}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          chat_bubble
        </span>
        대화하기
      </button>
      {isConversationBusy && (
        <p className="agent-detail-chat-hint">응답이 끝나면 대화를 전환할 수 있어요.</p>
      )}

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

      {/* 설정 창에서 저장한 프롬프트도 상세 패널의 입력란에 반영합니다. */}
      <AgentPromptEditor
        key={agent.prompt}
        prompt={agent.prompt ?? ""}
        onSave={onSavePrompt}
        busy={isConversationBusy}
      />

      {modeName && onOpenEmailSettings && (
        <AgentWorkspacePanel
          initialTab={initialWorkspaceTab}
          modeName={modeName}
          agent={agent}
          onOpenEmailSettings={onOpenEmailSettings}
        />
      )}

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
