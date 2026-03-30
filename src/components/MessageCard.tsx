import type { Message } from "@/types/chat";
import { MarkdownText } from "@/components/MarkdownText";

type MessageCardProps = {
  message: Message;
  onApprovePlan: () => void;
  onModifyPlan: () => void;
};

export function MessageCard({ message, onApprovePlan, onModifyPlan }: MessageCardProps) {
  const text = typeof message.text === "string" ? message.text : "";
  const bubbleText = text.trim();

  if (message.type === "status") {
    if (!message.statusText || !String(message.statusText).trim()) {
      return null;
    }

    return (
      <div className="message-status-wrap" key={message.id}>
        <span className="status-pill">{message.statusText}</span>
      </div>
    );
  }

  if (message.side === "user") {
    if (!bubbleText) {
      return null;
    }

    return (
      <div className="message-row user" key={message.id}>
        <div className="message-bubble user-bubble">
          <div className="bubble-meta-right">
            <span className="bubble-time">{message.byline}</span>
            <span className="bubble-name" style={{ color: "#fff" }}>
              {message.sender}
            </span>
          </div>
          <MarkdownText className="bubble-text" text={bubbleText} />
        </div>
        <div className="message-avatar avatar-user">{message.avatarText}</div>
      </div>
    );
  }

  const classes = ["message-row", "agent", message.type === "typing" ? "typing" : ""].filter(
    Boolean
  );
  const logs = Array.isArray(message.logs) ? message.logs : [];

  return (
    <div className={classes.join(" ")} key={message.id}>
      <div
        className="message-avatar avatar-agent"
        style={{ color: message.iconColor || "#94a3b8" }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
          {message.icon}
        </span>
      </div>
      <div className="message-bubble">
        <div className="bubble-meta">
          <span className="bubble-name" style={{ color: message.iconColor || "#a5b4fc" }}>
            {message.sender}
          </span>
          {message.byline ? <span className="bubble-time">{message.byline}</span> : null}
        </div>
        {message.type === "plan" ? (
          <>
            <p className="bubble-text plan-text">{message.planTitle}</p>
            <ol className="plan-list">
              {(message.steps ?? []).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <div className="message-actions">
              <button type="button" className="pill-btn" onClick={onApprovePlan}>
                계획 승인
              </button>
              <button type="button" className="pill-btn outline" onClick={onModifyPlan}>
                수정 요청
              </button>
            </div>
          </>
        ) : null}
        {message.type === "search" ? (
          <>
            {bubbleText ? <MarkdownText className="bubble-text" text={bubbleText} /> : null}
            <div className="tool-log-box">
              <div className="tool-log-title">
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: "14px", color: "#94a3b8" }}
                >
                  terminal
                </span>
                <span>tool_execution.log</span>
              </div>
              <div className="tool-log-body">
                <pre>{logs.map((line) => `${line}\n`).join("")}</pre>
              </div>
            </div>
          </>
        ) : null}
        {message.type === "text" && bubbleText ? (
          <MarkdownText className="bubble-text" text={bubbleText} />
        ) : null}
        {message.type === "typing" ? (
          <div className="typing-card" aria-live="polite">
            <div className="typing-inline">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-label">{bubbleText || "응답을 준비하고 있어요"}</span>
            </div>
            <div className="typing-progress" aria-hidden="true">
              <span className="typing-progress-bar" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
