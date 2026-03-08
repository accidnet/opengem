import { useEffect, useRef, type KeyboardEvent } from "react";

import { MessageCard } from "@/components/MessageCard";
import type { Message } from "@/types/chat";

type ChatPanelProps = {
  messages: Message[];
  inputValue: string;
  canSend: boolean;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onEnterSubmit: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onApprovePlan: () => void;
  onModifyPlan: () => void;
};

export function ChatPanel({
  messages,
  inputValue,
  canSend,
  onInputChange,
  onSubmit,
  onEnterSubmit,
  onApprovePlan,
  onModifyPlan,
}: ChatPanelProps) {
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  return (
    <section className="chat-panel">
      <div className="chat-scroll">
        <div className="chat-content">
          {messages.length === 0 && (
            <div className="chat-empty-state" aria-live="polite">
              <span className="material-symbols-outlined" aria-hidden="true">
                forum
              </span>
              <p>오늘은 무슨 일을 해볼까?</p>
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
