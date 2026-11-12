import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { MarkdownText } from "@/components/MarkdownText";
import {
  deleteAgentRoutine,
  getAgentMemory,
  getEmailSettings,
  listAgentReports,
  listAgentRoutines,
  runAgentRoutineNow,
  saveAgentMemory,
  saveEmailRoutine,
  setAgentRoutineEnabled,
  type AgentReport,
  type AgentRoutine,
} from "@/features/agent/api";
import type { AgentItem } from "@/types/chat";

import "./AgentWorkspacePanel.css";

type AgentWorkspacePanelProps = {
  modeName: string;
  agent: AgentItem;
  onOpenEmailSettings: () => void;
  initialTab?: "memory" | "routines" | "reports";
};

function formatTime(value: number | null) {
  return value ? new Date(value).toLocaleString("ko-KR") : "아직 실행하지 않았어요";
}

function AgentWorkspaceContent({
  modeName,
  agent,
  onOpenEmailSettings,
  initialTab = "memory",
}: AgentWorkspacePanelProps & { agent: AgentItem & { agentId: string } }) {
  const agentId = agent.agentId;
  const [tab, setTab] = useState<"memory" | "routines" | "reports">(initialTab);
  const [memory, setMemory] = useState("");
  const [savedMemory, setSavedMemory] = useState("");
  const [memoryUpdatedAt, setMemoryUpdatedAt] = useState<number | null>(null);
  const [routines, setRoutines] = useState<AgentRoutine[]>([]);
  const [reports, setReports] = useState<AgentReport[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [instruction, setInstruction] = useState(
    "새 이메일을 요약하고, 일정이 있으면 날짜·시간·장소와 원문 링크를 정리해 줘."
  );
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  const [loading, setLoading] = useState(true);
  const [routineEditorOpen, setRoutineEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const memoryVersion = useRef(0);
  const dirty = memory !== savedMemory;
  const memoryBytes = new TextEncoder().encode(memory).length;
  const memoryTooLarge = memoryBytes > 24 * 1024;

  // 에이전트를 바꾸면 컴포넌트가 다시 만들어져 이전 응답이 새 에이전트에 섞이지 않습니다.
  const reloadOverview = useCallback(async () => {
    const [nextRoutines, nextReports, email] = await Promise.all([
      listAgentRoutines({ modeName, agentId }),
      listAgentReports({ modeName, agentId }),
      getEmailSettings(),
    ]);
    if (!alive.current) return;
    setRoutines(nextRoutines);
    setReports(nextReports);
    setConnected(email.connected);
  }, [modeName, agentId]);

  const reloadMemory = useCallback(async () => {
    const version = memoryVersion.current;
    const next = await getAgentMemory({ modeName, agentId });
    if (!alive.current || version !== memoryVersion.current) return;
    setMemory(next.content);
    setSavedMemory(next.content);
    setMemoryUpdatedAt(next.updatedAt);
  }, [modeName, agentId]);

  useEffect(() => {
    alive.current = true;
    void Promise.all([reloadMemory(), reloadOverview()])
      .catch((cause) => {
        if (alive.current) setError(String(cause));
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    const timer = window.setInterval(() => {
      void reloadOverview().catch(() => {});
    }, 15_000);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, [reloadMemory, reloadOverview]);

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ modeName: string; agentId: string }>).detail;
      if (detail?.modeName !== modeName || detail.agentId !== agentId) return;
      void Promise.all([reloadOverview(), ...(!dirty ? [reloadMemory()] : [])]).catch((cause) => {
        if (alive.current) setError(String(cause));
      });
    };
    window.addEventListener("agent-workspace-updated", handleUpdate);
    return () => window.removeEventListener("agent-workspace-updated", handleUpdate);
  }, [modeName, agentId, dirty, reloadMemory, reloadOverview]);

  const perform = async (operation: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      await reloadOverview();
      if (alive.current) setNotice(message);
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const saveMemory = async () => {
    const next = await saveAgentMemory({
      modeName,
      agentId,
      content: memory,
      expectedUpdatedAt: memoryUpdatedAt,
    });
    if (!alive.current) return;
    setSavedMemory(next.content);
    setMemory(next.content);
    setMemoryUpdatedAt(next.updatedAt);
  };

  const saveRoutine = (event: FormEvent) => {
    event.preventDefault();
    const minutes = Number(intervalMinutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10080) {
      setError("실행 간격은 5분부터 10,080분 사이의 정수로 입력해 주세요.");
      return;
    }
    void perform(
      () =>
        saveEmailRoutine({
          modeName,
          agentId,
          instruction: instruction.trim(),
          intervalMinutes: minutes,
          enabled: true,
        }),
      "이메일 업무를 저장했어요. 실행 시간이 되면 이 에이전트가 확인합니다."
    );
  };

  return (
    <section className="agent-workspace" aria-label={agent.name + " 기억과 반복 업무"}>
      <div className="agent-workspace-heading">
        <h4>나의 기억과 업무</h4>
        <button
          type="button"
          disabled={busy || loading}
          onClick={() =>
            void perform(async () => {
              if (!dirty) await reloadMemory();
            }, "최신 기록을 불러왔어요.")
          }
          aria-label="기억과 업무 새로고침"
        >
          새로고침
        </button>
      </div>
      <p className="agent-workspace-help">
        이 에이전트의 기억은 새 대화에도 이어져요. 다른 에이전트와는 따로 보관합니다.
      </p>
      <div className="agent-workspace-tabs" role="group" aria-label="에이전트 기록 보기">
        <button type="button" aria-pressed={tab === "memory"} onClick={() => setTab("memory")}>
          기억
        </button>
        <button type="button" aria-pressed={tab === "routines"} onClick={() => setTab("routines")}>
          반복 업무 {routines.length > 0 && routines.length}
        </button>
        <button type="button" aria-pressed={tab === "reports"} onClick={() => setTab("reports")}>
          보고서 {reports.length > 0 && reports.length}
        </button>
      </div>
      {loading && <p role="status">기록을 불러오는 중이에요.</p>}
      {error && (
        <p className="agent-workspace-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="agent-workspace-notice" role="status">
          {notice}
        </p>
      )}
      {!loading && tab === "memory" && (
        <div className="agent-workspace-memory">
          <label>
            <span>MEMORY.md</span>
            <textarea
              value={memory}
              disabled={busy}
              rows={10}
              onChange={(event) => {
                memoryVersion.current += 1;
                setMemory(event.target.value);
              }}
              placeholder="예: 나는 오전 회의를 선호해. 일정은 한국 시간으로 알려 줘."
            />
          </label>
          <p className="agent-workspace-help">
            선호하는 방식, 맡긴 일, 기억할 내용을 Markdown으로 저장해요. 직접 수정하거나 지울 수
            있어요.
          </p>
          <small className={memoryTooLarge ? "agent-workspace-error" : undefined}>
            기억 저장 용량: {(memoryBytes / 1024).toFixed(1)} / 24 KB
          </small>
          {memoryUpdatedAt && <small>마지막 수정: {formatTime(memoryUpdatedAt)}</small>}
          <div className="agent-workspace-actions">
            {dirty && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  memoryVersion.current += 1;
                  setMemory(savedMemory);
                  setError("");
                }}
              >
                수정 취소
              </button>
            )}
            <button
              type="button"
              className="is-primary"
              disabled={busy || !dirty || memoryTooLarge}
              onClick={() => void perform(saveMemory, "기억을 저장했어요.")}
            >
              {busy ? "저장 중…" : "기억 저장"}
            </button>
          </div>
        </div>
      )}
      {!loading && tab === "routines" && (
        <div className="agent-workspace-routines">
          <div className="agent-email-connection">
            <strong>{connected ? "Gmail 연결됨" : "이메일 연결이 필요해요"}</strong>
            <button type="button" onClick={onOpenEmailSettings}>
              전체 이메일 설정
            </button>
          </div>
          <p className="agent-workspace-help">
            앱이 실행 중일 때 주기적으로 확인하고, 종료 중 놓친 업무는 다시 열면 이어서 확인해요.
            요약에는 AI 제공자 설정도 필요합니다.
          </p>
          {routines.map((routine) => (
            <article className="agent-routine-card" key={routine.id}>
              <div className="agent-routine-title">
                <strong>이메일 요약</strong>
                <span>{routine.enabled ? "실행 예약" : "일시 중지"}</span>
              </div>
              <p>{routine.instruction}</p>
              <dl>
                <div>
                  <dt>간격</dt>
                  <dd>{routine.intervalMinutes}분</dd>
                </div>
                <div>
                  <dt>최근 실행</dt>
                  <dd>{formatTime(routine.lastRunAt)}</dd>
                </div>
                {routine.enabled && (
                  <div>
                    <dt>다음 확인</dt>
                    <dd>{formatTime(routine.nextRunAt)}</dd>
                  </div>
                )}
              </dl>
              {routine.lastError && <p className="agent-workspace-error">{routine.lastError}</p>}
              <div className="agent-workspace-actions">
                <button
                  type="button"
                  disabled={busy || !connected || !routine.enabled}
                  onClick={() =>
                    void perform(
                      () => runAgentRoutineNow({ modeName, agentId, routineId: routine.id }),
                      "즉시 실행을 요청했어요. 완료되면 보고서에서 확인할 수 있어요."
                    )
                  }
                >
                  지금 확인
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void perform(
                      () =>
                        setAgentRoutineEnabled({
                          modeName,
                          agentId,
                          routineId: routine.id,
                          enabled: !routine.enabled,
                        }),
                      routine.enabled ? "업무를 일시 중지했어요." : "업무를 다시 시작했어요."
                    )
                  }
                >
                  {routine.enabled ? "중지" : "재개"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setRoutineEditorOpen(true);
                    setInstruction(routine.instruction);
                    setIntervalMinutes(String(routine.intervalMinutes));
                    setNotice("아래에서 내용을 수정하고 저장해 주세요.");
                  }}
                >
                  수정
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("이 반복 업무를 삭제할까요?"))
                      void perform(
                        () => deleteAgentRoutine({ modeName, agentId, routineId: routine.id }),
                        "반복 업무를 삭제했어요."
                      );
                  }}
                >
                  삭제
                </button>
              </div>
            </article>
          ))}
          <details
            className="agent-routine-create"
            open={routines.length === 0 || routineEditorOpen}
            onToggle={(event) => setRoutineEditorOpen(event.currentTarget.open)}
          >
            <summary>{routines.length ? "이메일 업무 설정 변경" : "이메일 업무 만들기"}</summary>
            <form onSubmit={saveRoutine}>
              <label>
                <span>맡길 일</span>
                <textarea
                  rows={4}
                  value={instruction}
                  disabled={busy}
                  required
                  maxLength={4000}
                  onChange={(event) => setInstruction(event.target.value)}
                />
              </label>
              <label>
                <span>확인 간격 (분)</span>
                <input
                  type="number"
                  min={5}
                  max={10080}
                  step={1}
                  required
                  value={intervalMinutes}
                  disabled={busy}
                  onChange={(event) => setIntervalMinutes(event.target.value)}
                />
              </label>
              <button type="submit" className="is-primary" disabled={busy || !instruction.trim()}>
                {routines.length ? "업무 변경 후 실행" : "업무 저장"}
              </button>
            </form>
          </details>
          <p className="agent-workspace-help">
            대화로 “매시간 새 이메일을 요약하고 일정도 정리해 줘”라고 맡길 수도 있어요. 일정은
            보고서에 정리되며 캘린더에는 자동 등록되지 않아요.
          </p>
        </div>
      )}
      {!loading && tab === "reports" && (
        <div className="agent-workspace-reports">
          {reports.length === 0 && (
            <p className="agent-workspace-help">
              아직 보고서가 없어요. 반복 업무를 맡기면 새 이메일 요약과 일정이 여기에 쌓여요.
            </p>
          )}
          {reports.map((report) => (
            <details
              className="agent-report-card"
              key={report.id}
              open={reports[0]?.id === report.id}
            >
              <summary>
                <span>{report.status === "error" ? "실행 오류" : "이메일 보고서"}</span>
                <time>{formatTime(report.createdAt)}</time>
              </summary>
              <MarkdownText text={report.content} className="agent-report-content" />
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

export function AgentWorkspacePanel(props: AgentWorkspacePanelProps) {
  if (!props.agent.agentId)
    return <p className="agent-workspace-help">에이전트를 먼저 저장해 주세요.</p>;
  return (
    <AgentWorkspaceContent
      key={props.modeName + ":" + props.agent.agentId}
      {...props}
      agent={{ ...props.agent, agentId: props.agent.agentId }}
    />
  );
}
