import { useEffect, useState, type RefObject, type MutableRefObject } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  claimDueSchedules,
  completeSchedule,
  notifyAgentWorkspace,
  type AgentScope,
} from "./api";
import { runSchedule } from "./runSchedule";

export type RoutineNotice = AgentScope & { routineId: string; agentName: string; text: string };

export function useAgentRoutines(
  isInstallingRef: RefObject<boolean>,
  busyRef: MutableRefObject<boolean>
) {
  const [notice, setNotice] = useState<RoutineNotice | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let activeAbort: AbortController | null = null;
    const tick = async () => {
      if (disposed || busyRef.current || isInstallingRef.current) return;
      busyRef.current = true;
      try {
        const jobs = await claimDueSchedules();
        for (const job of jobs) {
          const scope = { modeName: job.modeName, agentId: job.agentId ?? "" };
          const recipient = { ...scope, routineId: job.id, agentName: job.agentName };
          const controller = new AbortController();
          activeAbort = controller;
          // 실행 임대 시간보다 짧은 제한으로 중단된 실행이 다음 실행과 겹치지 않게 합니다.
          const timeout = window.setTimeout(() => controller.abort(), 8 * 60 * 1000);
          try {
            if (disposed) throw new Error("앱 화면이 닫혀 다음 실행에서 다시 처리합니다.");
            const text = await runSchedule(job, controller.signal);
            if (!disposed && text) setNotice({ ...recipient, text });
          } catch (error) {
            const raw =
              typeof error === "string" ? error : error instanceof Error ? error.message : "";
            // 공급자 응답 본문/토큰을 실행 기록에 복사하지 않습니다.
            const message =
              /^(이메일|Gmail|Google|새 메일|앱 화면|Provider|선택한 모델|사용할 모델|예약)/.test(
                raw
              )
                ? raw.slice(0, 500)
                : "예약 실행에 실패했습니다. 연결과 모델 설정을 확인해 주세요.";
            const recorded = await completeSchedule({
              routineId: job.id,
              leaseId: job.leaseId,
              report: message,
              error: message,
            }).then(
              () => true,
              () => false
            );
            if (!disposed && recorded) setNotice({ ...recipient, text: message });
          } finally {
            window.clearTimeout(timeout);
            activeAbort = null;
            if (!disposed) notifyAgentWorkspace(scope);
          }
        }
      } catch {
        // DB 초기화/종료 중 실패는 다음 틱에서 재시도합니다.
      } finally {
        busyRef.current = false;
      }
    };
    // StrictMode의 초기 정리 전에 DB 실행 임대를 잡지 않습니다.
    const startup = window.setTimeout(() => void tick(), 0);
    const timer = window.setInterval(() => void tick(), 15000);
    const wake = () => void tick();
    window.addEventListener("focus", wake);
    window.addEventListener("agent-workspace-updated", wake);
    return () => {
      disposed = true;
      activeAbort?.abort();
      window.clearTimeout(startup);
      window.clearInterval(timer);
      window.removeEventListener("focus", wake);
      window.removeEventListener("agent-workspace-updated", wake);
    };
  }, [isInstallingRef, busyRef]);
  return { notice, clearNotice: () => setNotice(null), busyRef };
}
