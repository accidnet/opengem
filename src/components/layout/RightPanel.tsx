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
        <div>
          <span className="right-eyebrow">SESSION INSIGHTS</span>
          <h3>활동 기록</h3>
        </div>
        <span className="activity-count">{activity.length}건</span>
      </header>

      <div className="activity-scroll">
        <div className="activity-intro">
          <span className="activity-intro-icon material-symbols-outlined" aria-hidden="true">
            monitoring
          </span>
          <div>
            <strong>우리 팀의 활동</strong>
            <p>현재 대화에서 진행된 작업을 살펴보세요.</p>
          </div>
        </div>
        <div className="activity-section-heading">
          <h4>최근 활동</h4>
          <span>{activity.length}건</span>
        </div>
        {activity.length > 0 ? (
          <div className="activity-timeline">
            {activity.map((item) => (
              <ActivityCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="activity-empty">
            <span className="material-symbols-outlined" aria-hidden="true">
              list_alt
            </span>
            <p>
              아직 활동 기록이 없어요.
              <br />
              대화를 시작하면 여기에 표시됩니다.
            </p>
          </div>
        )}
      </div>

      <section className="system-resources">
        <div className="resource-section-heading">
          <div>
            <h4>세션 사용량</h4>
            <p>현재 대화의 예상 사용량</p>
          </div>
          <span className="material-symbols-outlined" aria-hidden="true">
            insights
          </span>
        </div>
        <div className="resource">
          <div className="resource-head">
            <span>사용한 토큰</span>
            <span className="resource-value">{resourceToken.toLocaleString()}</span>
          </div>
          <div className="bar-track">
            <div className="bar-fill bar-fill-primary" style={{ width: `${tokenPercent}%` }} />
          </div>
        </div>
        <div className="resource">
          <div className="resource-head">
            <span>예상 API 비용</span>
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
