import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AgentReport } from "./api";

export type ScheduleScope = { modeName: string; agentId: string | null };
export type Schedule = ScheduleScope & {
  id: string;
  title: string;
  kind: "prompt" | "email";
  instruction: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt: number | null;
  lastError: string | null;
};
type ScheduleInput = Pick<
  Schedule,
  "modeName" | "agentId" | "title" | "kind" | "instruction" | "intervalMinutes"
> & {
  id?: string;
  firstRunAt?: number;
};

const storageKey = "opengem.schedules.v1";

function readBrowserSchedules(): Schedule[] {
  return JSON.parse(localStorage.getItem(storageKey) ?? "[]");
}

async function updateBrowserSchedules<T>(update: (schedules: Schedule[]) => T): Promise<T> {
  const write = () => {
    const schedules = readBrowserSchedules();
    const result = update(schedules);
    localStorage.setItem(storageKey, JSON.stringify(schedules));
    return result;
  };
  return navigator.locks ? navigator.locks.request(storageKey, write) : write();
}

function notifyChange(scope?: ScheduleScope) {
  window.dispatchEvent(new CustomEvent("agent-workspace-updated", { detail: scope }));
}

export async function listSchedules(): Promise<Schedule[]> {
  return isTauri() ? invoke<Schedule[]>("list_schedules") : readBrowserSchedules();
}

export async function saveSchedule(input: ScheduleInput): Promise<Schedule> {
  const title = input.title.trim();
  const instruction = input.instruction.trim();
  if (!title || [...title].length > 120) throw new Error("예약 이름을 1~120자로 입력해 주세요.");
  if (!instruction || new TextEncoder().encode(instruction).length > 8000)
    throw new Error("예약 지시를 8,000바이트 이내로 입력해 주세요.");
  if (
    !Number.isInteger(input.intervalMinutes) ||
    input.intervalMinutes < 5 ||
    input.intervalMinutes > 10080
  )
    throw new Error("예약 간격은 5분에서 7일 사이로 설정해 주세요.");
  if (
    input.firstRunAt !== undefined &&
    (!Number.isSafeInteger(input.firstRunAt) ||
      input.firstRunAt <= 0 ||
      input.firstRunAt > 253402300799999)
  )
    throw new Error("첫 실행 일시를 확인해 주세요.");
  let schedule: Schedule;
  if (isTauri()) {
    schedule = await invoke<Schedule>("save_schedule", { input });
  } else {
    schedule = await updateBrowserSchedules((schedules) => {
      const existing = schedules.find((s) => s.id === input.id);
      if (
        input.id &&
        (!existing ||
          existing.agentId !== input.agentId ||
          existing.modeName !== input.modeName ||
          existing.kind !== input.kind)
      )
        throw new Error("원래 대상에서 변경할 예약을 찾을 수 없습니다.");
      const saved: Schedule = {
        id: existing?.id ?? crypto.randomUUID(),
        title,
        kind: input.kind,
        instruction,
        modeName: input.modeName,
        agentId: input.agentId,
        intervalMinutes: input.intervalMinutes,
        enabled: existing?.enabled ?? true,
        lastRunAt: existing?.lastRunAt ?? null,
        lastError: null,
        nextRunAt:
          input.firstRunAt ?? existing?.nextRunAt ?? Date.now() + input.intervalMinutes * 60000,
      };
      if (existing) schedules[schedules.indexOf(existing)] = saved;
      else schedules.push(saved);
      return saved;
    });
  }
  notifyChange(schedule);
  return schedule;
}

async function changeSchedule(id: string, action: "run" | "resume" | "pause" | "delete") {
  if (isTauri()) {
    await invoke("change_schedule", { id, action });
  } else {
    if (action === "run") throw new Error("예약 실행은 데스크톱 앱에서 사용할 수 있어요.");
    await updateBrowserSchedules((schedules) => {
      const index = schedules.findIndex((s) => s.id === id);
      if (index === -1) throw new Error("예약을 찾을 수 없습니다.");
      if (action === "delete") schedules.splice(index, 1);
      else schedules[index].enabled = action === "resume";
    });
  }
  notifyChange();
}

export const setScheduleEnabled = (id: string, enabled: boolean) =>
  changeSchedule(id, enabled ? "resume" : "pause");
export const runScheduleNow = (id: string) => changeSchedule(id, "run");
export const deleteSchedule = (id: string) => changeSchedule(id, "delete");
export const listScheduleReports = async (id: string): Promise<AgentReport[]> =>
  isTauri() ? invoke<AgentReport[]>("list_schedule_reports", { id }) : [];
