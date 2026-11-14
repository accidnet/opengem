import { useEffect, useState, type RefObject, type MutableRefObject } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { request } from "@/features/ai";
import { getGlobalPrompt } from "@/features/app/globalPrompt";
import { withGlobalPrompt } from "@/features/chat/globalInstructions";
import {
  claimDueEmailRoutines,
  completeEmailRoutine,
  fetchEmailDigestMessages,
  getEmailRoutineSeenIds,
  getEmailSettings,
  getAgentMemory,
  runAgentRoutineNow,
  notifyAgentWorkspace,
  type AgentScope,
} from "./api";
import { prepareEmailDigest } from "./digest";
import { resolveAgentModel } from "./model";
import EMAIL_DIGEST_SKILL from "./skills/email-digest.txt?raw";

export type RoutineNotice = AgentScope & { agentName: string; text: string };

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
        const jobs = await claimDueEmailRoutines();
        for (const job of jobs) {
          const scope = { modeName: job.modeName, agentId: job.agentId };
          const controller = new AbortController();
          activeAbort = controller;
          // 실행 임대 시간보다 짧은 제한으로 중단된 실행이 다음 실행과 겹치지 않게 합니다.
          const timeout = window.setTimeout(() => controller.abort(), 8 * 60 * 1000);
          try {
            if (disposed) throw new Error("앱 화면이 닫혀 다음 실행에서 다시 처리합니다.");
            const email = await getEmailSettings();
            if (!email.connected)
              throw new Error(
                "이메일 연결이 필요합니다. 사용자 메뉴 → Google 연동에서 Gmail을 연결해 주세요."
              );
            if (job.mailboxEmail && job.mailboxEmail !== email.email)
              throw new Error(
                "이메일 계정이 변경되었습니다. 기존 업무를 삭제하고 새 계정의 업무를 등록해 주세요."
              );
            const settings = await resolveAgentModel(job.agentModel);
            const [memory, globalPrompt] = await Promise.all([
              getAgentMemory(scope),
              getGlobalPrompt(),
            ]);
            const scanUntil = Date.now();
            const result = await prepareEmailDigest(job, scanUntil, {
              fetchPage: async (input) => {
                controller.signal.throwIfAborted();
                return fetchEmailDigestMessages(input);
              },
              getSeenIds: (mailboxEmail, messageIds) =>
                getEmailRoutineSeenIds({
                  routineId: job.id,
                  leaseId: job.leaseId,
                  mailboxEmail,
                  messageIds,
                }),
              summarize: async (messages) => {
                controller.signal.throwIfAborted();
                const summary = await request({
                  ...settings,
                  apiBaseUrl: settings.baseUrl,
                  stream: true,
                  signal: controller.signal,
                  messages: [
                    { role: "system", content: withGlobalPrompt(globalPrompt, EMAIL_DIGEST_SKILL) },
                    {
                      role: "user",
                      content: JSON.stringify({
                        agentName: job.agentName,
                        persona: job.agentPrompt,
                        memory: memory.content,
                        instruction: job.instruction,
                        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        emails: messages,
                      }),
                    },
                  ],
                });
                return summary.text;
              },
            });
            controller.signal.throwIfAborted();
            const currentEmail = await getEmailSettings();
            if (!currentEmail.connected || currentEmail.email !== result.mailboxEmail)
              throw new Error(
                "이메일 연결이 변경되어 결과를 저장하지 않았습니다. 연결 상태를 확인해 주세요."
              );
            await completeEmailRoutine({ routineId: job.id, leaseId: job.leaseId, ...result });
            if (result.checkpoint < scanUntil)
              await runAgentRoutineNow({ ...scope, routineId: job.id }).catch(() => {});
            if (!disposed && result.hasNewMessages)
              setNotice({
                ...scope,
                agentName: job.agentName,
                text: "새 이메일 요약과 일정 후보를 정리했습니다.",
              });
          } catch (error) {
            const raw =
              typeof error === "string" ? error : error instanceof Error ? error.message : "";
            // 공급자 응답 본문/토큰을 실행 기록에 복사하지 않습니다.
            const message =
              /^(이메일|Gmail|Google|새 메일|앱 화면|Provider|선택한 모델|사용할 모델|반복|OpenAI)/.test(
                raw
              )
                ? raw.slice(0, 500)
                : "이메일 요약에 실패했습니다. 이메일 연결과 모델 설정을 확인해 주세요. 다음 실행에 재시도합니다.";
            await completeEmailRoutine({
              routineId: job.id,
              leaseId: job.leaseId,
              report: message,
              error: message,
            }).catch(() => {});
            if (!disposed) setNotice({ ...scope, agentName: job.agentName, text: message });
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
