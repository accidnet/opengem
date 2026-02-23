import type { ActivityItem, ActivityState } from "@/types/chat";

type ActivityCardProps = {
  item: ActivityItem;
};

export function ActivityCard({ item }: ActivityCardProps) {
  const timelineDotClass: Record<ActivityState, string> = {
    done: "timeline-dot-done",
    active: "timeline-dot-active",
    working: "timeline-dot-working",
    pending: "timeline-dot-pending",
  };

  return (
    <div className={`timeline-item ${item.faded ? "timeline-item-faded" : ""}`}>
      <div className={`timeline-dot ${timelineDotClass[item.state]}`} />
      <div className="timeline-body">
        <div className="timeline-title-wrap">
          <span className="timeline-name">{item.source}</span>
          <span className="timeline-time">{item.byline || "진행 중"}</span>
        </div>
        <p className="timeline-text">{item.text}</p>
        {item.progress ? (
          <div className="progress-wrap">
            {item.progress.map((state, idx) => (
              <span key={idx} className={`progress-seg ${state}`} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
