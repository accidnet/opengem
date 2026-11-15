import type { Mode } from "@/features/app/config/appData";
import type { SessionItem } from "@/types/chat";
import { SessionList } from "./SessionList";

type ModeSectionProps = {
  modes: readonly Mode[];
  selectedMode: Mode;
  currentAgentId: string | null;
  openModes: Record<Mode, boolean>;
  getModeIcon: (mode: Mode) => string;
  sessionsByMode: Record<Mode, SessionItem[]>;
  onModeClick: (mode: Mode) => void;
  onToggleMode: (mode: Mode) => void;
  onOpenSettings: () => void;
  onSessionSelect: (session: SessionItem) => void | Promise<void>;
  onSessionDelete: (session: SessionItem) => void | Promise<void>;
};

export function ModeSection({
  modes,
  selectedMode,
  currentAgentId,
  openModes,
  getModeIcon,
  sessionsByMode,
  onModeClick,
  onToggleMode,
  onOpenSettings,
  onSessionSelect,
  onSessionDelete,
}: ModeSectionProps) {
  return (
    <section className="panel-block">
      <div className="section-head-with-action">
        <h3 className="section-title">Operation Mode</h3>
        <button className="small-icon-btn" type="button" title="모드 설정" onClick={onOpenSettings}>
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
            add
          </span>
        </button>
      </div>
      <div className="panel-list">
        {modes.map((mode, index) => {
          const modeSessions = (sessionsByMode[mode] ?? []).filter(
            (session) => session.agentId == null
          );
          const isCurrent = mode === selectedMode && currentAgentId === null;
          const isOpen = openModes[mode] ?? mode === selectedMode;
          const sessionListId = `mode-sub-sessions-${index}`;

          return (
            <div key={mode} className="mode-group">
              <div className="mode-heading">
                <button
                  type="button"
                  className={`mode-btn ${isCurrent ? "is-active" : ""}`}
                  onClick={() => onModeClick(mode)}
                  aria-current={isCurrent ? "true" : undefined}
                  aria-label={`${mode} 전체 대화`}
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
                </button>
                {modeSessions.length > 0 && (
                  <button
                    type="button"
                    className="small-icon-btn"
                    onClick={() => onToggleMode(mode)}
                    aria-label={`${mode} 전체 대화 기록 ${isOpen ? "접기" : "펼치기"}`}
                    aria-expanded={isOpen}
                    aria-controls={sessionListId}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                      {isOpen ? "expand_less" : "expand_more"}
                    </span>
                  </button>
                )}
              </div>
              {modeSessions.length > 0 && (
                <SessionList
                  id={sessionListId}
                  isOpen={isOpen}
                  sessions={modeSessions}
                  label={`${mode} 전체 대화 기록`}
                  onSessionSelect={onSessionSelect}
                  onSessionDelete={onSessionDelete}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
