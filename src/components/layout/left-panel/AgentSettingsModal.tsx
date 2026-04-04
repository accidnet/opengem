import type { KeyboardEvent, MutableRefObject } from "react";

import { ModelSelect } from "@/components/ModelSelect";
import type { AgentColor } from "@/types/chat";

import { AGENT_COLOR_LABELS, AGENT_COLOR_OPTIONS, AGENT_ICON_OPTIONS } from "./constants";
import type { AgentIconOption, AgentSettingsTab, DraftAgentItem } from "./types";

type AgentSettingsModalProps = {
  isOpen: boolean;
  agentSettingsTab: AgentSettingsTab;
  newAgentName: string;
  newAgentIcon: AgentIconOption;
  newAgentColor: AgentColor;
  newAgentModel: string;
  newAgentPrompt: string;
  newAgentTools: string;
  newAgentMcpServers: string;
  newAgentSkills: string;
  agentNameError: string;
  draftAgents: DraftAgentItem[];
  suppressOverlayCloseRef: MutableRefObject<boolean>;
  onClose: () => void;
  onOverlayClick: () => void;
  onTabChange: (tab: AgentSettingsTab) => void;
  onNewAgentNameChange: (value: string) => void;
  onNewAgentIconChange: (icon: AgentIconOption) => void;
  onNewAgentColorChange: (color: AgentColor) => void;
  onNewAgentModelChange: (value: string) => void;
  onNewAgentPromptChange: (value: string) => void;
  onNewAgentToolsChange: (value: string) => void;
  onNewAgentMcpServersChange: (value: string) => void;
  onNewAgentSkillsChange: (value: string) => void;
  onCreateAgent: () => void;
  onCreateAgentOnEnter: (event: KeyboardEvent<HTMLInputElement>) => void;
  onDraftAgentChange: <K extends keyof DraftAgentItem>(
    id: string,
    key: K,
    value: DraftAgentItem[K]
  ) => void;
  onSetMainAgent: (id: string) => void;
  onMoveDraftAgent: (index: number, direction: "up" | "down") => void;
  onRemoveDraftAgent: (id: string) => void;
  onSave: () => void | Promise<void>;
};

export function AgentSettingsModal({
  isOpen,
  agentSettingsTab,
  newAgentName,
  newAgentIcon,
  newAgentColor,
  newAgentModel,
  newAgentPrompt,
  newAgentTools,
  newAgentMcpServers,
  newAgentSkills,
  agentNameError,
  draftAgents,
  suppressOverlayCloseRef,
  onClose,
  onOverlayClick,
  onTabChange,
  onNewAgentNameChange,
  onNewAgentIconChange,
  onNewAgentColorChange,
  onNewAgentModelChange,
  onNewAgentPromptChange,
  onNewAgentToolsChange,
  onNewAgentMcpServersChange,
  onNewAgentSkillsChange,
  onCreateAgent,
  onCreateAgentOnEnter,
  onDraftAgentChange,
  onSetMainAgent,
  onMoveDraftAgent,
  onRemoveDraftAgent,
  onSave,
}: AgentSettingsModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="settings-overlay" role="presentation" onClick={onOverlayClick}>
      <section
        className="panel-modal agent-panel-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel-modal-header">
          <div className="panel-modal-header-title-wrap">
            <span className="panel-modal-header-icon material-symbols-outlined" aria-hidden="true">
              hub
            </span>
            <h3 id="agent-settings-title" className="settings-title">
              Agents
            </h3>
          </div>
          <button
            className="panel-modal-close-btn"
            type="button"
            aria-label="에이전트 설정 창 닫기"
            onClick={onClose}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </header>

        <div className="panel-modal-body">
          <aside className="panel-modal-sidebar agent-panel-modal-sidebar" aria-label="agent 설정 탭">
            <p className="panel-modal-sidebar-label">AGENTS</p>
            <p className="panel-modal-sidebar-help">에이전트를 추가하고 순서를 관리해요.</p>

            <button
              className={`panel-modal-nav-item ${agentSettingsTab === "create" ? "is-active" : ""}`}
              type="button"
              aria-current={agentSettingsTab === "create" ? "true" : undefined}
              onClick={() => onTabChange("create")}
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                person_add
              </span>
              <span>Agent 추가</span>
            </button>
            <button
              className={`panel-modal-nav-item ${agentSettingsTab === "list" ? "is-active" : ""}`}
              type="button"
              aria-current={agentSettingsTab === "list" ? "true" : undefined}
              onClick={() => onTabChange("list")}
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                format_list_bulleted
              </span>
              <span>Agent 목록</span>
            </button>
          </aside>

          <main className="panel-modal-main agent-panel-modal-main">
            {agentSettingsTab === "create" ? (
              <>
                <div className="panel-modal-main-copy">
                  <h4>Agent 추가</h4>
                  <p>기본 정보와 모델, 프롬프트, 연결 리소스를 함께 설정해서 새 에이전트를 만들어요.</p>
                </div>

                <section className="settings-card agent-create-card">
                  <div className="settings-card-head settings-card-head-column">
                    <div>
                      <h4>기본 설정</h4>
                      <p>이름, 아이콘, 색상을 정하면 좌측 Active Agents에 바로 반영돼요.</p>
                    </div>
                  </div>

                  <label className="settings-field">
                    <span>에이전트 이름</span>
                    <input
                      className="settings-input"
                      type="text"
                      placeholder="새 에이전트 이름"
                      value={newAgentName}
                      onMouseDown={() => {
                        suppressOverlayCloseRef.current = true;
                      }}
                      onChange={(event) => onNewAgentNameChange(event.target.value)}
                      onKeyDown={onCreateAgentOnEnter}
                      aria-label="새 에이전트 이름"
                    />
                  </label>

                  <label className="settings-field">
                    <span>아이콘</span>
                    <select
                      className="settings-input"
                      value={newAgentIcon}
                      onChange={(event) => onNewAgentIconChange(event.target.value as AgentIconOption)}
                      aria-label="새 에이전트 아이콘"
                    >
                      {AGENT_ICON_OPTIONS.map((iconName) => (
                        <option key={iconName} value={iconName}>
                          {iconName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field">
                    <span>색상</span>
                    <select
                      className="settings-input"
                      value={newAgentColor}
                      onChange={(event) => onNewAgentColorChange(event.target.value as AgentColor)}
                      aria-label="새 에이전트 색상"
                    >
                      {AGENT_COLOR_OPTIONS.map((colorName) => (
                        <option key={colorName} value={colorName}>
                          {AGENT_COLOR_LABELS[colorName]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field settings-field-wide">
                    <span>모델</span>
                    <ModelSelect
                      value={newAgentModel}
                      placeholder="gpt-5.4"
                      ariaLabel="새 에이전트 모델"
                      onChange={onNewAgentModelChange}
                      onInteract={() => {
                        suppressOverlayCloseRef.current = true;
                      }}
                    />
                  </label>
                </section>

                <section className="settings-card agent-config-card">
                  <div className="settings-card-head settings-card-head-column">
                    <div>
                      <h4>작업 컨텍스트</h4>
                      <p>프롬프트와 연결 항목은 줄바꿈 단위로 여러 값을 입력할 수 있어요.</p>
                    </div>
                  </div>

                  <label className="settings-field settings-field-wide">
                    <span>프롬프트 설정</span>
                    <textarea
                      className="settings-input settings-textarea"
                      rows={5}
                      placeholder="이 에이전트가 맡을 역할과 작업 방식을 적어 주세요."
                      value={newAgentPrompt}
                      onChange={(event) => onNewAgentPromptChange(event.target.value)}
                      aria-label="새 에이전트 프롬프트 설정"
                    />
                  </label>

                  <label className="settings-field">
                    <span>Tools</span>
                    <textarea
                      className="settings-input settings-textarea settings-textarea-compact"
                      rows={4}
                      placeholder="웹 브라우저&#10;파일 시스템"
                      value={newAgentTools}
                      onChange={(event) => onNewAgentToolsChange(event.target.value)}
                      aria-label="새 에이전트 tool 설정"
                    />
                  </label>

                  <label className="settings-field">
                    <span>MCP</span>
                    <textarea
                      className="settings-input settings-textarea settings-textarea-compact"
                      rows={4}
                      placeholder="github&#10;postgres"
                      value={newAgentMcpServers}
                      onChange={(event) => onNewAgentMcpServersChange(event.target.value)}
                      aria-label="새 에이전트 MCP 설정"
                    />
                  </label>

                  <label className="settings-field">
                    <span>Skill</span>
                    <textarea
                      className="settings-input settings-textarea settings-textarea-compact"
                      rows={4}
                      placeholder="design-review&#10;api-design"
                      value={newAgentSkills}
                      onChange={(event) => onNewAgentSkillsChange(event.target.value)}
                      aria-label="새 에이전트 skill 설정"
                    />
                  </label>
                </section>

                {agentNameError && <p className="settings-error">{agentNameError}</p>}
              </>
            ) : (
              <>
                <div className="panel-modal-main-copy">
                  <h4>Agent 목록</h4>
                  <p>순서 변경, 삭제, 그리고 각 에이전트의 이름과 아이콘을 바로 정리할 수 있어요.</p>
                </div>

                <section className="settings-card agent-list-card">
                  <div className="settings-card-head">
                    <div>
                      <h4>현재 에이전트</h4>
                      <p>총 {draftAgents.length}개 에이전트</p>
                    </div>
                  </div>

                  <div className="mode-settings-list agent-settings-list" role="list" aria-label="Active agents 목록">
                    {draftAgents.map((agent, index) => (
                      <div className="mode-settings-item agent-settings-item" role="listitem" key={agent.id}>
                        <div className={`agent-dot ${agent.color}`} aria-hidden="true">
                          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                            {agent.icon}
                          </span>
                        </div>
                        <input
                          className="mode-settings-input"
                          value={agent.name}
                          aria-label={`${agent.name || "agent"} 이름 수정`}
                          onMouseDown={() => {
                            suppressOverlayCloseRef.current = true;
                          }}
                          onChange={(event) => onDraftAgentChange(agent.id, "name", event.target.value)}
                        />
                        <div className="mode-settings-select-wrap">
                          <select
                            className="mode-settings-select"
                            value={agent.icon}
                            onChange={(event) => onDraftAgentChange(agent.id, "icon", event.target.value)}
                            aria-label={`${agent.name || "agent"} 아이콘 변경`}
                          >
                            {AGENT_ICON_OPTIONS.map((iconName) => (
                              <option key={iconName} value={iconName}>
                                {iconName}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="mode-settings-select-wrap">
                          <select
                            className="mode-settings-select"
                            value={agent.color}
                            onChange={(event) =>
                              onDraftAgentChange(agent.id, "color", event.target.value as AgentColor)
                            }
                            aria-label={`${agent.name || "agent"} 색상 변경`}
                          >
                            {AGENT_COLOR_OPTIONS.map((colorName) => (
                              <option key={colorName} value={colorName}>
                                {AGENT_COLOR_LABELS[colorName]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          className="small-icon-btn"
                          type="button"
                          title={agent.role === "main" ? "메인 에이전트" : "메인 에이전트로 설정"}
                          aria-label={
                            agent.role === "main"
                              ? `${agent.name || "agent"} 메인 에이전트`
                              : `${agent.name || "agent"} 메인 에이전트로 설정`
                          }
                          disabled={agent.role === "main"}
                          onClick={() => onSetMainAgent(agent.id)}
                          style={{ color: agent.role === "main" ? "#fbbf24" : undefined }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                            {agent.role === "main" ? "star" : "star_border"}
                          </span>
                        </button>
                        <button
                          className="small-icon-btn"
                          type="button"
                          title="위로 이동"
                          onClick={() => onMoveDraftAgent(index, "up")}
                          disabled={index === 0}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                            arrow_upward
                          </span>
                        </button>
                        <button
                          className="small-icon-btn"
                          type="button"
                          title="아래로 이동"
                          onClick={() => onMoveDraftAgent(index, "down")}
                          disabled={index === draftAgents.length - 1}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                            arrow_downward
                          </span>
                        </button>
                        <button
                          className="small-icon-btn danger"
                          type="button"
                          title="에이전트 제거"
                          onClick={() => onRemoveDraftAgent(agent.id)}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                            delete
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                {agentNameError && <p className="settings-error">{agentNameError}</p>}
              </>
            )}
          </main>
        </div>

        <footer className="settings-footer agent-settings-footer">
          <button className="settings-secondary-btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <div className="agent-settings-footer-actions">
            {agentSettingsTab === "create" && (
              <button className="settings-secondary-btn" type="button" onClick={onCreateAgent}>
                Agent 추가
              </button>
            )}
            <button className="settings-primary-btn" type="button" onClick={onSave}>
              Done
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
