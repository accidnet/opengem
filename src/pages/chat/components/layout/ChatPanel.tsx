import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";

import { MessageCard } from "@/components/MessageCard";
import { AgentOffice } from "@/pages/chat/components/office/AgentOffice";
import { normalizeProjectPath } from "@/lib/projectPaths";
import { getErrorMessage } from "@/features/app/appHelpers";
import type { AgentItem, Message } from "@/types/chat";

type ChatPanelProps = {
  conversationLabel: string;
  conversationModel: string;
  conversationError: string;
  executionMode: "chat" | "codex" | "computer";
  onExecutionModeChange: (mode: "chat" | "codex" | "computer") => void;
  canUseCodex: boolean;
  isCodexRunning: boolean;
  onCancelCodex: () => void;
  isComputerRunning: boolean;
  onCancelComputer: () => void;
  isConversationBusy: boolean;
  onStartAgentChat: (index: number) => void;
  agents: AgentItem[];
  selectedAgentIndex: number | null;
  onSelectAgent: (index: number) => void;
  workspaceView: "office" | "chat";
  onWorkspaceViewChange: (view: "office" | "chat") => void;
  messages: Message[];
  currentSessionId: string | null;
  currentSessionProjectPaths: string[];
  defaultProjectPaths: string[];
  inputValue: string;
  canSend: boolean;
  onOpenProjectFolder: (path: string) => void | Promise<void>;
  onUpdateSessionProjectPaths: (projectPaths: string[]) => void | Promise<void>;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onEnterSubmit: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onApprovePlan: () => void;
  onModifyPlan: () => void;
};

export function ChatPanel({
  conversationLabel,
  conversationModel,
  conversationError,
  executionMode,
  onExecutionModeChange,
  canUseCodex,
  isCodexRunning,
  onCancelCodex,
  isComputerRunning,
  onCancelComputer,
  isConversationBusy,
  onStartAgentChat,
  agents,
  selectedAgentIndex,
  onSelectAgent,
  workspaceView,
  onWorkspaceViewChange,
  messages,
  currentSessionId,
  currentSessionProjectPaths,
  defaultProjectPaths,
  inputValue,
  canSend,
  onOpenProjectFolder,
  onUpdateSessionProjectPaths,
  onInputChange,
  onSubmit,
  onEnterSubmit,
  onApprovePlan,
  onModifyPlan,
}: ChatPanelProps) {
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatContentRef = useRef<HTMLDivElement | null>(null);
  const projectPanelRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowStreamRef = useRef(true);
  const lastTypingMessageIdRef = useRef<string | null>(null);
  const [isProjectPanelOpen, setIsProjectPanelOpen] = useState(false);
  const [projectError, setProjectError] = useState("");
  const currentSessionIdRef = useRef(currentSessionId);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
    setIsProjectPanelOpen(false);
    setProjectError("");
  }, [currentSessionId]);

  const projectPaths = currentSessionId ? currentSessionProjectPaths : defaultProjectPaths;
  const hasConnectedProjects = projectPaths.length > 0;

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior });
    }
  };

  useEffect(() => {
    if (workspaceView !== "chat") {
      chatContentRef.current?.scrollTo({ top: 0 });
      return;
    }
    if (messages.length === 0) {
      // 새 대화에서는 안내 화면의 시작 부분을 보여줍니다.
      chatContentRef.current?.scrollTo({ top: 0 });
      shouldFollowStreamRef.current = true;
      lastTypingMessageIdRef.current = null;
      return;
    }

    const latestTypingMessage = [...messages]
      .reverse()
      .find((message) => message.type === "typing");
    const latestTypingMessageId = latestTypingMessage?.id ?? null;

    if (latestTypingMessageId && latestTypingMessageId !== lastTypingMessageIdRef.current) {
      lastTypingMessageIdRef.current = latestTypingMessageId;
      shouldFollowStreamRef.current = true;
      scrollToBottom("smooth");
      return;
    }

    if (!latestTypingMessageId) {
      lastTypingMessageIdRef.current = null;
    }

    if (shouldFollowStreamRef.current) {
      scrollToBottom();
    }
  }, [messages, workspaceView]);

  useEffect(() => {
    if (!isProjectPanelOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (!projectPanelRef.current?.contains(event.target as Node)) {
        setIsProjectPanelOpen(false);
      }
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsProjectPanelOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isProjectPanelOpen]);

  const persistProjectPaths = async (nextPaths: string[]) => {
    if (!currentSessionId) {
      setProjectError("세션을 생성한 뒤에 프로젝트 폴더를 설정할 수 있어요.");
      return;
    }

    await onUpdateSessionProjectPaths(nextPaths);
    setProjectError("");
  };

  const handleRemoveProjectPath = async (targetPath: string) => {
    await persistProjectPaths(projectPaths.filter((path) => path !== targetPath));
  };

  const handlePickProjectPath = async () => {
    if (!currentSessionId) {
      setProjectError("세션을 생성한 뒤에 프로젝트 폴더를 설정할 수 있어요.");
      return;
    }

    const pickedPath = await invoke<string | null>("pick_project_folder");
    // 폴더 선택 창이 열린 사이 대화가 바뀌면 이전 대화의 경로를 반영하지 않습니다.
    if (currentSessionIdRef.current !== currentSessionId) return;
    if (!pickedPath) {
      return;
    }

    const normalizedPath = normalizeProjectPath(pickedPath);
    const exists = projectPaths.some((path) => path.toLowerCase() === normalizedPath.toLowerCase());
    if (exists) {
      setProjectError("이미 연결된 프로젝트 폴더예요.");
      return;
    }

    await persistProjectPaths([...projectPaths, normalizedPath]);
  };

  const handleChatViewportInteraction = () => {
    shouldFollowStreamRef.current = false;
  };

  return (
    <section className="chat-panel">
      <nav className="workspace-tabs" aria-label="작업 공간 화면">
        <button
          type="button"
          className={workspaceView === "office" ? "is-active" : ""}
          aria-current={workspaceView === "office" ? "page" : undefined}
          onClick={() => onWorkspaceViewChange("office")}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            space_dashboard
          </span>{" "}
          에이전트 오피스
        </button>
        <button
          type="button"
          className={workspaceView === "chat" ? "is-active" : ""}
          aria-current={workspaceView === "chat" ? "page" : undefined}
          onClick={() => onWorkspaceViewChange("chat")}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            chat_bubble
          </span>{" "}
          대화
        </button>
      </nav>
      {workspaceView === "chat" && (
        <div className="conversation-target" aria-live="polite">
          <strong>{conversationLabel}</strong>
          <span>{conversationModel}</span>
          {isConversationBusy && <span>처리 중…</span>}
        </div>
      )}
      {conversationError && (
        <p className="conversation-error" role="alert">
          {conversationError}
        </p>
      )}
      <div className="chat-scroll">
        <div
          ref={chatContentRef}
          className="chat-content"
          onMouseDown={handleChatViewportInteraction}
          onWheel={handleChatViewportInteraction}
          onTouchStart={handleChatViewportInteraction}
        >
          {workspaceView === "office" ? (
            <AgentOffice
              onStartChat={onStartAgentChat}
              isConversationBusy={isConversationBusy}
              agents={agents}
              selectedAgentIndex={selectedAgentIndex}
              onSelectAgent={onSelectAgent}
            />
          ) : messages.length === 0 ? (
            <div className="chat-empty-state" aria-live="polite">
              <div className="chat-start-hint">
                <span className="material-symbols-outlined" aria-hidden="true">
                  chat_bubble
                </span>
                <div>
                  <strong>대화를 시작해 보세요</strong>
                  <p>아래에 메시지를 입력하면 에이전트가 함께할게요.</p>
                </div>
              </div>
            </div>
          ) : null}
          {workspaceView === "chat" &&
            messages.map((message) => (
              <MessageCard
                key={message.id}
                message={message}
                onApprovePlan={onApprovePlan}
                onModifyPlan={onModifyPlan}
              />
            ))}
          {workspaceView === "chat" && <div ref={chatEndRef} />}
        </div>
      </div>

      {workspaceView === "chat" && (
        <footer className="composer-wrap">
          <div className="composer-floating-actions">
            {canUseCodex && (
              <label className="chip">
                실행 방식{" "}
                <select
                  aria-label="실행 방식"
                  value={executionMode}
                  disabled={isConversationBusy}
                  onChange={(event) =>
                    onExecutionModeChange(event.target.value as "chat" | "codex" | "computer")
                  }
                >
                  <option value="chat">일반 대화</option>
                  <option value="codex">Codex 개발 실행</option>
                  <option value="computer">컴퓨터 제어</option>
                </select>
              </label>
            )}
            <div className="project-chip-wrap" ref={projectPanelRef}>
              {isProjectPanelOpen && (
                <div className="project-path-popover">
                  <div className="project-path-popover-head">
                    <div>
                      <strong>세션 프로젝트</strong>
                      <p>
                        {currentSessionId
                          ? "이 세션에 연결된 프로젝트 폴더를 관리해요."
                          : "세션 생성 전이라 기본 프로젝트 폴더만 확인할 수 있어요."}
                      </p>
                    </div>
                  </div>

                  <div className="project-path-popover-list">
                    {hasConnectedProjects ? (
                      projectPaths.map((projectPath) => (
                        <div className="project-path-row" key={projectPath}>
                          <button
                            type="button"
                            className="project-path-label"
                            title={projectPath}
                            onClick={() => void onOpenProjectFolder(projectPath)}
                          >
                            {projectPath}
                          </button>
                          <div className="project-path-row-actions">
                            <button
                              type="button"
                              className="small-icon-btn"
                              title="폴더 열기"
                              onClick={() => void onOpenProjectFolder(projectPath)}
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: "16px" }}
                              >
                                folder_open
                              </span>
                            </button>
                            <button
                              type="button"
                              className="small-icon-btn danger"
                              title="경로 제거"
                              disabled={isConversationBusy}
                              onClick={() =>
                                void handleRemoveProjectPath(projectPath).catch((error) =>
                                  setProjectError(getErrorMessage(error))
                                )
                              }
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: "16px" }}
                              >
                                close
                              </span>
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="project-path-empty">연결된 프로젝트가 없어요.</p>
                    )}
                  </div>

                  <div className="project-path-editor">
                    <div className="project-path-editor-actions">
                      <button
                        type="button"
                        className="chip project-chip-secondary"
                        onClick={() =>
                          void handlePickProjectPath().catch((error) =>
                            setProjectError(getErrorMessage(error))
                          )
                        }
                        disabled={!currentSessionId || isConversationBusy}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                          folder_open
                        </span>
                        폴더 선택
                      </button>
                    </div>
                    {projectError && <p className="project-path-error">{projectError}</p>}
                  </div>
                </div>
              )}

              <button
                type="button"
                className={`chip project-chip ${hasConnectedProjects ? "is-active" : "is-empty"}`}
                onClick={() => setIsProjectPanelOpen((prev) => !prev)}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                  folder_code
                </span>
                {hasConnectedProjects ? `Projects ${projectPaths.length}` : "프로젝트 없음"}
              </button>
            </div>
          </div>

          {executionMode === "computer" && (
            <p className="composer-hint">
              요청을 보내면 제어할 창을 선택합니다. Windows와 이미지 지원 모델이 필요해요. 선택한
              창을 확인하며 클릭·입력·스크롤하고, 중지 버튼이나 F8로 멈출 수 있습니다.
            </p>
          )}
          {executionMode === "codex" && (
            <p className="composer-hint">
              Codex CLI 로그인과 프로젝트 폴더가 필요합니다. 파일을 수정하고 명령을 실행할 수
              있습니다. 최근 텍스트 대화만 전달되며 이전 CLI 도구 이력은 이어지지 않습니다.
            </p>
          )}
          <div className="composer-box">
            <textarea
              value={inputValue}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  canSend
                )
                  onWorkspaceViewChange("chat");
                onEnterSubmit(event);
              }}
              placeholder={`${conversationLabel}에 메시지를 보내세요`}
              aria-label="메시지 입력"
              rows={1}
            />
            <div className="composer-actions">
              <span className="composer-hint">Enter로 보내기 · Shift + Enter로 줄바꿈</span>
              {isComputerRunning && (
                <button type="button" className="chip" onClick={onCancelComputer}>
                  컴퓨터 제어 중지
                </button>
              )}
              {isCodexRunning && (
                <button type="button" className="chip" onClick={onCancelCodex}>
                  작업 취소
                </button>
              )}
              <button
                className="send-btn"
                type="button"
                onClick={() => {
                  onWorkspaceViewChange("chat");
                  onSubmit();
                }}
                disabled={!canSend}
                aria-label="메시지 보내기"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
                  arrow_upward
                </span>
              </button>
            </div>
          </div>
          <p className="disclaimer">AI가 생성한 내용은 확인이 필요할 수 있어요.</p>
        </footer>
      )}
    </section>
  );
}
