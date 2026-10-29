import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";

import { MessageCard } from "@/components/MessageCard";
import officeScene from "@/assets/agent-office-scene.svg";
import { normalizeProjectPath } from "@/lib/projectPaths";
import type { Message } from "@/types/chat";

type ChatPanelProps = {
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

  const projectPaths = currentSessionId ? currentSessionProjectPaths : defaultProjectPaths;
  const hasConnectedProjects = projectPaths.length > 0;

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior });
    }
  };

  useEffect(() => {
    if (messages.length === 0) {
      // 새 대화에서는 안내 화면의 시작 부분을 보여줍니다.
      chatContentRef.current?.parentElement?.scrollTo({ top: 0 });
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
  }, [messages]);

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
      <div className="chat-scroll">
        <div
          ref={chatContentRef}
          className="chat-content"
          onMouseDown={handleChatViewportInteraction}
          onWheel={handleChatViewportInteraction}
          onTouchStart={handleChatViewportInteraction}
        >
          {messages.length === 0 && (
            <div className="chat-empty-state" aria-live="polite">
              <div className="chat-welcome">
                <span className="chat-welcome-eyebrow">YOUR LITTLE TEAM, BIG IDEAS ✳</span>
                <h1>
                  좋은 아이디어가 모이는 곳<span>.</span>
                </h1>
                <p>오늘은 에이전트와 어떤 일을 함께할까요?</p>
              </div>
              <div className="chat-office">
                <div className="chat-office-head">
                  <strong>
                    <span aria-hidden="true">✳</span> 우리 팀 오피스
                  </strong>
                  <span className="chat-office-badge">WORKSPACE</span>
                </div>
                <div className="chat-office-scene">
                  <img
                    src={officeScene}
                    alt="에이전트들이 각자의 책상에서 일하는 픽셀 아트 오피스"
                  />
                  <span className="chat-office-caption">✳ &nbsp; 함께 만드는 중</span>
                </div>
                <div className="chat-office-foot">
                  작은 아이디어도, 함께라면 크게 <span aria-hidden="true">✦</span>
                </div>
              </div>
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
          )}
          {messages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              onApprovePlan={onApprovePlan}
              onModifyPlan={onModifyPlan}
            />
          ))}
          <div ref={chatEndRef} />
        </div>
      </div>

      <footer className="composer-wrap">
        <div className="composer-floating-actions">
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
                            onClick={() => void handleRemoveProjectPath(projectPath)}
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
                      onClick={() => void handlePickProjectPath()}
                      disabled={!currentSessionId}
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

        <div className="composer-box">
          <textarea
            value={inputValue}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onEnterSubmit}
            placeholder="어떤 일을 함께 해볼까요?"
            aria-label="메시지 입력"
            rows={1}
          />
          <div className="composer-actions">
            <span className="composer-hint">Enter로 보내기 · Shift + Enter로 줄바꿈</span>
            <button
              className="send-btn"
              type="button"
              onClick={onSubmit}
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
    </section>
  );
}
