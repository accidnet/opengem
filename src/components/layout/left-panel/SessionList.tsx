import { formatSessionTime } from "@/pages/chat/utils";
import type { SessionItem } from "@/types/chat";

type SessionListProps = {
  sessions: SessionItem[];
  label: string;
  id?: string;
  isOpen?: boolean;
  onSessionSelect: (session: SessionItem) => void | Promise<void>;
  onSessionDelete: (session: SessionItem) => void | Promise<void>;
};

/** 모드와 에이전트가 각각 자신의 기록에 같은 선택·삭제 동작을 사용합니다. */
export function SessionList({
  sessions,
  label,
  id,
  isOpen = true,
  onSessionSelect,
  onSessionDelete,
}: SessionListProps) {
  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      className={`sub-session-list ${isOpen ? "is-open" : ""}`}
      aria-hidden={!isOpen}
    >
      {sessions.map((session) => (
        <div
          key={session.id}
          className={`session-row ${session.active ? "session-row-active" : ""}`}
        >
          <button
            type="button"
            className="session-row-main"
            tabIndex={isOpen ? 0 : -1}
            aria-current={session.active ? "true" : undefined}
            onClick={() => onSessionSelect(session)}
          >
            <span>{session.title}</span>
            <span>{formatSessionTime(session.updatedAt)}</span>
          </button>
          <button
            type="button"
            className="session-row-delete"
            tabIndex={isOpen ? 0 : -1}
            title="세션 삭제"
            aria-label={`${session.title} 세션 삭제`}
            onClick={() => onSessionDelete(session)}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
              delete
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
