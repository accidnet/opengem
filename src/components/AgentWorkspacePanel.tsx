import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { AgentMemoryDialog } from "@/components/AgentMemoryDialog";
import { MarkdownText } from "@/components/MarkdownText";
import { listAgentReports } from "@/features/agent/api";
import type { AgentItem } from "@/types/chat";

import "./AgentWorkspacePanel.css";

type AgentWorkspacePanelProps = {
  modeName: string;
  agent: AgentItem;
  onOpenSchedules: () => void;
};

export function AgentWorkspacePanel({
  modeName,
  agent,
  onOpenSchedules,
}: AgentWorkspacePanelProps) {
  const [tab, setTab] = useState<"memory" | "reports">("memory");
  const [notice, setNotice] = useState("");
  const agentId = agent.agentId;
  const {
    data: reports = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["agent-reports", modeName, agentId],
    queryFn: () => listAgentReports({ modeName, agentId: agentId! }),
    enabled: !!agentId && tab === "reports" && isTauri(),
    retry: false,
  });
  useEffect(() => {
    if (!agentId || tab !== "reports" || !isTauri()) return;
    const refresh = () => void refetch();
    window.addEventListener("agent-workspace-updated", refresh);
    return () => window.removeEventListener("agent-workspace-updated", refresh);
  }, [agentId, tab, refetch]);

  if (!agentId) return <p className="agent-workspace-help">에이전트를 먼저 저장해 주세요.</p>;
  return (
    <section className="agent-workspace" aria-label={agent.name + " 기억과 업무"}>
      <div className="agent-workspace-heading">
        <h4>나의 기억과 업무</h4>
      </div>
      <div className="agent-workspace-tabs" role="group" aria-label="에이전트 기록 보기">
        <button type="button" aria-pressed={tab === "memory"} onClick={() => setTab("memory")}>
          기억
        </button>
        <button type="button" onClick={onOpenSchedules}>
          예약
        </button>
        <button type="button" aria-pressed={tab === "reports"} onClick={() => setTab("reports")}>
          보고서
        </button>
      </div>
      {tab === "memory" ? (
        <>
          <AgentMemoryDialog
            modeName={modeName}
            agentId={agentId}
            agentName={agent.name}
            onSaved={() => setNotice("기억을 저장했어요.")}
          />
          {notice && (
            <p role="status" className="agent-workspace-notice">
              {notice}
            </p>
          )}
        </>
      ) : (
        <div className="agent-workspace-reports">
          {isLoading && <p role="status">보고서를 불러오는 중…</p>}
          {error && (
            <p role="alert">
              {String(error)}{" "}
              <button type="button" onClick={() => void refetch()}>
                다시 시도
              </button>
            </p>
          )}
          {!error && !isLoading && reports.length === 0 && (
            <p className="agent-workspace-help">아직 실행 보고서가 없어요.</p>
          )}
          {reports.map((report, index) => (
            <details className="agent-report-card" key={report.id} open={index === 0}>
              <summary>
                <span>{report.status === "error" ? "실행 오류" : "실행 보고서"}</span>
                <time>{new Date(report.createdAt).toLocaleString("ko-KR")}</time>
              </summary>
              <MarkdownText text={report.content} className="agent-report-content" />
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
