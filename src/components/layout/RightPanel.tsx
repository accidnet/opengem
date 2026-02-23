import { ActivityCard } from "@/components/ActivityCard";
import type { ActivityItem } from "@/types/chat";

type RightPanelProps = {
  activity: ActivityItem[];
  resourceToken: number;
  resourceCost: number;
  tokenPercent: number;
  costPercent: number;
};

export function RightPanel({
  activity,
  resourceToken,
  resourceCost,
  tokenPercent,
  costPercent,
}: RightPanelProps) {
  return (
    <aside className="right-panel">
      <header className="right-head">
        <h3>Activity Log</h3>
        <div className="toolbar-icons">
          <button className="small-icon-btn" type="button" title="View Graph">
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
              hub
            </span>
          </button>
          <button className="small-icon-btn" type="button" title="View Logs">
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
              list_alt
            </span>
          </button>
        </div>
      </header>

      <div className="activity-scroll">
        <div className="activity-timeline">
          {activity.map((item) => (
            <ActivityCard key={item.id} item={item} />
          ))}
        </div>
      </div>

      <section className="system-resources">
        <h4>System Resources</h4>
        <div className="resource">
          <div className="resource-head">
            <span>Tokens Used (Session)</span>
            <span className="resource-value">{resourceToken.toLocaleString()}</span>
          </div>
          <div className="bar-track">
            <div className="bar-fill bar-fill-primary" style={{ width: `${tokenPercent}%` }} />
          </div>
        </div>
        <div className="resource">
          <div className="resource-head">
            <span>API Cost Est.</span>
            <span className="resource-value">${resourceCost.toFixed(2)}</span>
          </div>
          <div className="bar-track">
            <div className="bar-fill bar-fill-green" style={{ width: `${costPercent}%` }} />
          </div>
        </div>
      </section>
    </aside>
  );
}
