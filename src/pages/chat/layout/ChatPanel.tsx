import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";

import { MessageCard } from "@/components/MessageCard";
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
  const [projectPathInput, setProjectPathInput] = useState("");
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [projectError, setProjectError] = useState("");

  const projectPaths = currentSessionId ? currentSessionProjectPaths : defaultProjectPaths;
  const hasConnectedProjects = projectPaths.length > 0;

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior });
    }
  };

  useEffect(() => {
    const latestTypingMessage = [...messages].reverse().find((message) => message.type === "typing");
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

  const normalizePath = (value: string) => {
    return value.trim().replace(/[\\/]+$/, "");
  };

  const persistProjectPaths = async (nextPaths: string[]) => {
    if (!currentSessionId) {
      setProjectError("세션이 생성된 뒤에 프로젝트 폴더를 수정할 수 있어.");
      return;
    }

    await onUpdateSessionProjectPaths(nextPaths);
    setProjectError("");
  };

  const handleAddProjectPath = async () => {
    const normalizedPath = normalizePath(projectPathInput);
    if (!normalizedPath) {
      setProjectError("프로젝트 폴더 경로를 입력해줘.");
      return;
    }

    if (editingPath) {
      const nextPaths = projectPaths.map((path) => (path === editingPath ? normalizedPath : path));
      await persistProjectPaths(nextPaths);
      setEditingPath(null);
      setProjectPathInput("");
      return;
    }

    const exists = projectPaths.some((path) => path.toLowerCase() === normalizedPath.toLowerCase());
    if (exists) {
      setProjectError("이미 연결된 프로젝트 폴더야.");
      return;
    }

    await persistProjectPaths([...projectPaths, normalizedPath]);
    setProjectPathInput("");
  };

  const handleRemoveProjectPath = async (targetPath: string) => {
    await persistProjectPaths(projectPaths.filter((path) => path !== targetPath));
    if (editingPath === targetPath) {
      setEditingPath(null);
      setProjectPathInput("");
    }
  };

  const handlePickProjectPath = async () => {
    const pickedPath = await invoke<string | null>("pick_project_folder");
    if (!pickedPath) {
      return;
    }

    setProjectPathInput(normalizePath(pickedPath));
    setProjectError("");
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
              <span className="material-symbols-outlined" aria-hidden="true">
                forum
              </span>
              <p>오늘은 무슨 일을 도와줄까?</p>
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
                        ? "이 세션에 연결된 프로젝트 폴더를 관리해."
                        : "세션 생성 전이라 기본 프로젝트 폴더만 확인할 수 있어."}
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
                          onClick={() => {
                            setProjectPathInput(projectPath);
                            setEditingPath(projectPath);
                            setProjectError("");
                          }}
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
                            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                              folder_open
                            </span>
                          </button>
                          <button
                            type="button"
                            className="small-icon-btn"
                            title="경로 수정"
                            onClick={() => {
                              setProjectPathInput(projectPath);
                              setEditingPath(projectPath);
                              setProjectError("");
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                              edit
                            </span>
                          </button>
                          <button
                            type="button"
                            className="small-icon-btn danger"
                            title="경로 제거"
                            onClick={() => void handleRemoveProjectPath(projectPath)}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                              close
                            </span>
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="project-path-empty">연결된 프로젝트가 없어.</p>
                  )}
                </div>

                <div className="project-path-editor">
                  <input
                    type="text"
                    className="project-path-editor-input"
                    value={projectPathInput}
                    placeholder="프로젝트 폴더 경로 입력"
                    onChange={(event) => {
                      setProjectPathInput(event.target.value);
                      setProjectError("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleAddProjectPath();
                      }
                    }}
                    disabled={!currentSessionId}
                  />
                  <div className="project-path-editor-actions">
                    <button type="button" className="chip project-chip-secondary" onClick={() => void handlePickProjectPath()} disabled={!currentSessionId}>
                      <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                        folder_open
                      </span>
                      폴더 선택
                    </button>
                    <button type="button" className="chip project-chip-primary" onClick={() => void handleAddProjectPath()} disabled={!currentSessionId}>
                      <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                        {editingPath ? "edit" : "add_circle"}
                      </span>
                      {editingPath ? "경로 수정" : "경로 추가"}
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

          <button type="button" className="chip">
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
              add_circle
            </span>
            Use File
          </button>
          <button type="button" className="chip">
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
              tune
            </span>
            Configure Agent
          </button>
        </div>

        <div className="composer-box">
          <textarea
            value={inputValue}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onEnterSubmit}
            placeholder="메시지 입력..."
            rows={1}
          />
          <div className="composer-actions">
            <button type="button" className="icon-btn">
              <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
                attach_file
              </span>
            </button>
            <button type="button" className="icon-btn">
              <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
                mic
              </span>
            </button>
            <button className="send-btn" type="button" onClick={onSubmit} disabled={!canSend}>
              <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
                arrow_upward
              </span>
            </button>
          </div>
        </div>
        <p className="disclaimer">AI can make mistakes. Verify critical information.</p>
      </footer>
    </section>
  );
}
