import type { ReactNode } from "react";

import { formatSessionTime } from "@/pages/chat/utils";
import type { SessionItem } from "@/types/chat";

type SessionListProps = {
  id?: string;
  label: string;
  isOpen: boolean;
  sessions: SessionItem[];
  onSessionSelect: (session: SessionItem) => void | Promise<void>;
  onSessionDelete: (session: SessionItem) => void | Promise<void>;
  children?: ReactNode;
};

export function SessionList({
  id,
  label,
  isOpen,
  sessions,
  onSessionSelect,
  onSessionDelete,
  children,
}: SessionListProps) {
  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      className={`sub-session-list ${isOpen ? "is-open" : ""}`}
      inert={!isOpen}
    >
      {children}
      {sessions.map((session) => (
        <div
          key={session.id}
          className={`session-row ${session.active ? "session-row-active" : ""}`}
        >
          <button
            type="button"
            className="session-row-main"
            aria-current={session.active ? "true" : undefined}
            title={session.title}
            onClick={() => void onSessionSelect(session)}
          >
            <span>{session.title}</span>
            <span>{formatSessionTime(session.updatedAt)}</span>
          </button>
          <button
            type="button"
            className="session-row-delete"
            title="세션 삭제"
            aria-label={`${session.title} 세션 삭제`}
            onClick={() => void onSessionDelete(session)}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              delete
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
