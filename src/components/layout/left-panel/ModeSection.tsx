import type { Mode } from "@/features/app/config/appData";
import type { SessionItem } from "@/types/chat";
import { SessionList } from "./SessionList";

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
    <section className="panel-block" aria-labelledby="operation-modes-label">
      <div className="section-head-with-action">
        <h3 id="operation-modes-label" className="section-title">
          Operation Mode
        </h3>
        <button className="small-icon-btn" type="button" title="모드 설정" onClick={onOpenSettings}>
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

              <SessionList
                id={sessionListId}
                label={`${mode} 대화 목록`}
                isOpen={isOpen}
                sessions={modeSessions}
                onSessionSelect={onSessionSelect}
                onSessionDelete={onSessionDelete}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
