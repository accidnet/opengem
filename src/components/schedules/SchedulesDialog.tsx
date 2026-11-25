import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { MarkdownText } from "@/components/MarkdownText";
import {
  deleteSchedule,
  listScheduleReports,
  listSchedules,
  runScheduleNow,
  setScheduleEnabled,
  type Schedule,
} from "@/features/agent/schedules";
import type { AgentItem } from "@/types/chat";
import { ScheduleEditor, type ScheduleTemplate } from "./ScheduleEditor";
import { intervalLabel } from "./intervalLabel";
import "./SchedulesDialog.css";

export type ScheduleEntry = { modeName?: string; agentId?: string; routineId?: string };
type Props = {
  entry: ScheduleEntry;
  modes: readonly string[];
  currentMode: string;
  currentAgents: AgentItem[];
  onClose: () => void;
  onOpenPlugins: () => void;
};
type Screen =
  | { view: "home" }
  | { view: "detail" | "edit"; id: string }
  | { view: "new"; template?: ScheduleTemplate };
const templates: (ScheduleTemplate & { icon: string; description: string })[] = [
  {
    icon: "✉️",
    title: "이메일 모니터링",
    description: "새 메일에서 답장이 필요한 일과 일정을 찾아요.",
    kind: "email",
    instruction: "새 이메일을 요약하고 답장이 필요한 일, 일정과 원문 링크를 정리해 줘.",
    intervalMinutes: 60,
  },
  {
    icon: "🗓️",
    title: "오늘의 업무 정리",
    description: "최근 대화에서 결정한 일과 다음 할 일을 정리해요.",
    kind: "prompt",
    instruction: "최근 대화에서 결정한 내용과 아직 해야 할 일을 구분해서 정리해 줘.",
    intervalMinutes: 1440,
  },
  {
    icon: "📝",
    title: "주간 업무 회고",
    description: "한 주 동안의 진행 상황과 남은 과제를 돌아봐요.",
    kind: "prompt",
    instruction: "최근 대화에 근거해 이번 주 진행 상황, 남은 과제와 다음 주 우선순위를 정리해 줘.",
    intervalMinutes: 10080,
  },
];
function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}
function Icon({ name }: { name: string }) {
  return (
    <span className="material-symbols-outlined" aria-hidden="true">
      {name}
    </span>
  );
}

function ScheduleDetail({
  item,
  target,
  onEdit,
  onDeleted,
}: {
  item: Schedule;
  target: string;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const client = useQueryClient();
  const history = useQuery({
    queryKey: ["schedules", "reports", item.id],
    queryFn: () => listScheduleReports(item.id),
    retry: false,
  });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function perform(operation: () => Promise<unknown>, success: string) {
    if (pending) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      await operation();
      await client.invalidateQueries({ queryKey: ["schedules"] });
      setMessage(success);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="schedule-detail">
      <span className="schedule-status">{item.enabled ? "예약됨" : "일시 정지됨"}</span>
      <h2>{item.title}</h2>
      <dl>
        <dt>실행 대상</dt>
        <dd>{target}</dd>
        <dt>반복</dt>
        <dd>{intervalLabel(item.intervalMinutes)}</dd>
        {item.enabled && (
          <>
            <dt>다음 실행</dt>
            <dd>{formatTime(item.nextRunAt)}</dd>
          </>
        )}
        {item.lastRunAt && (
          <>
            <dt>최근 실행</dt>
            <dd>{formatTime(item.lastRunAt)}</dd>
          </>
        )}
      </dl>
      <p className="schedule-instruction">{item.instruction}</p>
      <div className="schedule-actions">
        <button
          type="button"
          className="schedule-button primary"
          disabled={pending || !item.enabled || !isTauri()}
          onClick={() => void perform(() => runScheduleNow(item.id), "실행을 요청했어요.")}
        >
          지금 실행
        </button>
        <button type="button" className="schedule-button" disabled={pending} onClick={onEdit}>
          수정
        </button>
        <button
          type="button"
          className="schedule-button"
          disabled={pending}
          onClick={() => void perform(() => setScheduleEnabled(item.id, !item.enabled), "")}
        >
          {item.enabled ? "일시 정지" : "재개"}
        </button>
        <button
          type="button"
          className="schedule-button"
          disabled={pending}
          onClick={() => {
            if (window.confirm("이 예약과 실행 기록을 삭제할까요?"))
              void perform(async () => {
                await deleteSchedule(item.id);
                onDeleted();
              }, "");
          }}
        >
          삭제
        </button>
      </div>
      {!isTauri() && <p className="schedule-hint">예약 실행은 데스크톱 앱에서 사용할 수 있어요.</p>}
      {message && <p role="status">{message}</p>}
      {(error || item.lastError) && (
        <p className="schedule-error" role="alert">
          {error || item.lastError}
        </p>
      )}
      <section className="schedule-history">
        <h3>실행 기록</h3>
        {history.isLoading && <p role="status">실행 기록을 불러오는 중…</p>}
        {history.isError && (
          <p role="alert">
            {String(history.error)}{" "}
            <button className="schedule-text-button" onClick={() => void history.refetch()}>
              다시 시도
            </button>
          </p>
        )}
        {history.data?.length === 0 && <p className="schedule-hint">아직 실행 기록이 없어요.</p>}
        {history.data?.map((report, index) => (
          <details key={report.id} open={index === 0}>
            <summary>
              {formatTime(report.createdAt)} · {report.status === "error" ? "실패" : "완료"}
            </summary>
            <MarkdownText text={report.content} className="agent-report-content" />
          </details>
        ))}
      </section>
    </section>
  );
}

export function SchedulesDialog({
  entry,
  modes,
  currentMode,
  currentAgents,
  onClose,
  onOpenPlugins,
}: Props) {
  const [screen, setScreen] = useState<Screen>(
    entry.routineId ? { view: "detail", id: entry.routineId } : { view: "home" }
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(!!entry.modeName);
  const [modeFilter, setModeFilter] = useState(entry.modeName ?? "");
  // 빈 문자열은 모든 대상, null은 개인 에이전트가 없는 모드 예약입니다.
  const [agentFilter, setAgentFilter] = useState<string | null>(entry.agentId ?? "");
  const [pausedOpen, setPausedOpen] = useState(true);
  const client = useQueryClient();
  const list = useQuery({ queryKey: ["schedules", "list"], queryFn: listSchedules, retry: false });
  // 다른 모드의 에이전트를 읽을 때 현재 대화의 선택 상태는 유지합니다.
  const otherModes = modes.filter((m) => m !== currentMode);
  const rosters = useQueries({
    queries: otherModes.map((modeName) => ({
      queryKey: ["schedule-agents", modeName],
      enabled: isTauri(),
      retry: false,
      queryFn: () =>
        invoke<Pick<AgentItem, "name" | "agentId">[]>("load_mode_agents", { modeName }),
    })),
  });
  const agentsByMode = Object.fromEntries(otherModes.map((m, i) => [m, rosters[i].data ?? []]));
  agentsByMode[currentMode] = currentAgents;
  useEffect(() => {
    const refresh = () => void client.invalidateQueries({ queryKey: ["schedules"] });
    window.addEventListener("agent-workspace-updated", refresh);
    return () => window.removeEventListener("agent-workspace-updated", refresh);
  }, [client]);
  const all = list.data ?? [];
  const target = (s: Schedule) =>
    s.modeName +
    " · " +
    (s.agentId
      ? (agentsByMode[s.modeName]?.find((a) => a.agentId === s.agentId)?.name ?? "에이전트")
      : "모드 전체");
  const shown = all.filter(
    (s) =>
      (!modeFilter || s.modeName === modeFilter) &&
      (agentFilter === "" || s.agentId === agentFilter) &&
      (s.title + " " + target(s)).toLowerCase().includes(query.trim().toLowerCase())
  );
  const current = "id" in screen ? all.find((item) => item.id === screen.id) : undefined;
  const listRow = (s: Schedule) => (
    <button
      key={s.id}
      type="button"
      className="schedule-row"
      aria-current={current?.id === s.id ? "true" : undefined}
      onClick={() => setScreen({ view: "detail", id: s.id })}
    >
      <Icon name={s.kind === "email" ? "mail" : "event_note"} />
      <span>
        <strong>{s.title}</strong>
        <small>{target(s)}</small>
      </span>
    </button>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="schedule-dialog" aria-describedby={undefined}>
        <aside className="schedule-sidebar">
          <header>
            <DialogTitle>예약</DialogTitle>
            <button
              type="button"
              aria-label="예약 필터"
              aria-expanded={filterOpen}
              aria-pressed={!!modeFilter}
              onClick={() => setFilterOpen(!filterOpen)}
            >
              <Icon name="filter_list" />
            </button>
            <button
              type="button"
              aria-label="예약 검색"
              aria-expanded={searchOpen}
              onClick={() => {
                setSearchOpen(!searchOpen);
                setQuery("");
              }}
            >
              <Icon name="search" />
            </button>
          </header>
          {searchOpen && (
            <input
              className="schedule-search"
              autoFocus
              aria-label="검색어"
              placeholder="예약 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {filterOpen && (
            <div className="schedule-filters">
              <select
                aria-label="모드 필터"
                value={modeFilter}
                onChange={(e) => {
                  setModeFilter(e.target.value);
                  setAgentFilter("");
                  setScreen({ view: "home" });
                }}
              >
                <option value="">모든 모드</option>
                {modes.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              {modeFilter && (
                <select
                  aria-label="에이전트 필터"
                  value={agentFilter ?? ":mode"}
                  onChange={(e) => {
                    setAgentFilter(e.target.value === ":mode" ? null : e.target.value);
                    setScreen({ view: "home" });
                  }}
                >
                  <option value="">모든 대상</option>
                  <option value=":mode">모드 전체 예약</option>
                  {(agentsByMode[modeFilter] ?? [])
                    .filter((a) => a.agentId)
                    .map((a) => (
                      <option key={a.agentId} value={a.agentId}>
                        {a.name}
                      </option>
                    ))}
                </select>
              )}
            </div>
          )}
          <button className="schedule-new" type="button" onClick={() => setScreen({ view: "new" })}>
            <Icon name="add" />새 작업
          </button>
          <div className="schedule-list">
            {shown.filter((s) => s.enabled).map(listRow)}
            {shown.some((s) => !s.enabled) && (
              <>
                <button
                  type="button"
                  className="schedule-paused"
                  aria-expanded={pausedOpen}
                  onClick={() => setPausedOpen(!pausedOpen)}
                >
                  일시 정지됨 <Icon name={pausedOpen ? "expand_more" : "chevron_right"} />
                </button>
                {pausedOpen && shown.filter((s) => !s.enabled).map(listRow)}
              </>
            )}
            {list.isLoading && <p role="status">예약을 불러오는 중…</p>}
            {list.isError && (
              <p role="alert">
                예약을 불러오지 못했어요.{" "}
                <button
                  type="button"
                  className="schedule-text-button"
                  onClick={() => void list.refetch()}
                >
                  다시 시도
                </button>
              </p>
            )}
            {list.isSuccess && !shown.length && (query || modeFilter) && (
              <p>조건에 맞는 예약이 없어요.</p>
            )}
          </div>
        </aside>
        <div className="schedule-main">
          {screen.view === "new" || (screen.view === "edit" && current) ? (
            <ScheduleEditor
              key={screen.view === "new" ? (screen.template?.title ?? "new") : screen.id}
              item={current}
              scope={
                current ?? { modeName: modeFilter || currentMode, agentId: agentFilter || null }
              }
              template={screen.view === "new" ? screen.template : undefined}
              modes={modes}
              agentsByMode={agentsByMode}
              unavailableModes={otherModes.filter((_, i) => rosters[i].isError)}
              onOpenPlugins={onOpenPlugins}
              onCancel={() =>
                setScreen(current ? { view: "detail", id: current.id } : { view: "home" })
              }
              onSaved={(saved) => {
                setQuery("");
                if (modeFilter && modeFilter !== saved.modeName) setModeFilter(saved.modeName);
                if (agentFilter !== "" && agentFilter !== saved.agentId)
                  setAgentFilter(saved.agentId);
                client.setQueryData<Schedule[]>(["schedules", "list"], (old = []) => [
                  saved,
                  ...old.filter((item) => item.id !== saved.id),
                ]);
                void list.refetch();
                setScreen({ view: "detail", id: saved.id });
              }}
            />
          ) : current ? (
            <ScheduleDetail
              key={current.id}
              item={current}
              target={target(current)}
              onEdit={() => setScreen({ view: "edit", id: current.id })}
              onDeleted={() => setScreen({ view: "home" })}
            />
          ) : screen.view === "detail" || screen.view === "edit" ? (
            <p role="status">
              {list.isLoading
                ? "예약을 불러오는 중…"
                : list.isError
                  ? "예약 정보를 확인할 수 없어요."
                  : "이 예약이 삭제되었어요."}
            </p>
          ) : (
            <section className="schedule-home">
              <span className="schedule-clock">
                <Icon name="schedule" />
              </span>
              <h2>작업 예약하기</h2>
              <p>모드나 에이전트에 정기적으로 맡길 일을 선택하세요.</p>
              <div className="schedule-templates">
                {templates.map((t) => (
                  <button
                    key={t.title}
                    type="button"
                    onClick={() => setScreen({ view: "new", template: t })}
                  >
                    <span aria-hidden="true">{t.icon}</span>
                    <div>
                      <strong>{t.title}</strong>
                      <p>{t.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
