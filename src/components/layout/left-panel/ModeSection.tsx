import { formatSessionTime } from "@/utils/chat";
import type { Mode } from "@/data/appData";
import type { SessionItem } from "@/types/chat";

type ModeSectionProps = {
  modes: readonly Mode[];
  selectedMode: Mode;
  openModes: Record<Mode, boolean>;
  getModeIcon: (mode: Mode) => string;
  sessionsByMode: Record<Mode, SessionItem[]>;
  onModeClick: (mode: Mode) => void;
  onOpenSettings: () => void;
  onSessionSelect: (session: SessionItem) => void | Promise<void>;
  onSessionDelete: (session: SessionItem) => void | Promise<void>;
};

export function ModeSection({
  modes,
  selectedMode,
  openModes,
  getModeIcon,
  sessionsByMode,
  onModeClick,
  onOpenSettings,
  onSessionSelect,
  onSessionDelete,
}: ModeSectionProps) {
  return (
    <section className="panel-block">
      <div className="section-head-with-action">
        <h3 className="section-title">Operation Mode</h3>
        <button className="small-icon-btn" type="button" title="운영 설정" onClick={onOpenSettings}>
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
            add
          </span>
        </button>
      </div>
      <div className="panel-list">
        {modes.map((mode, index) => {
          const modeSessions = sessionsByMode[mode] || [];
          const isOpen = openModes[mode] ?? mode === selectedMode;
          const sessionListId = `mode-sub-sessions-${index}`;

          return (
            <div key={mode} className="mode-group">
              <button
                type="button"
                className={`mode-btn ${selectedMode === mode ? "is-active" : ""}`}
                onClick={() => onModeClick(mode)}
                aria-expanded={isOpen}
                aria-controls={sessionListId}
              >
                <div className="btn-side">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "20px", color: index === 0 ? "#38bdf8" : undefined }}
                  >
                    {getModeIcon(mode)}
                  </span>
                  <span>{mode}</span>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                  {isOpen ? "expand_less" : "expand_more"}
                </span>
              </button>

              <div
                id={sessionListId}
                className={`sub-session-list ${isOpen ? "is-open" : ""}`}
                aria-hidden={!isOpen}
              >
                {modeSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`session-row ${session.active ? "session-row-active" : ""}`}
                  >
                    <button
                      type="button"
                      className="session-row-main"
                      tabIndex={isOpen ? 0 : -1}
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
                      onClick={(event) => {
                        event.stopPropagation();
                        void onSessionDelete(session);
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                        delete
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
