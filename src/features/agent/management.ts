import { parseGoogleWorkspaceRequest, type GoogleWorkspaceRequest } from "./googlePlan.ts";

export type ManagementPlan = {
  memoryNote: string | null;
  google: GoogleWorkspaceRequest | null;
  routine: null | {
    action: "save" | "pause" | "resume" | "delete" | "run";
    instruction: string;
    intervalMinutes: number;
    sourceQuote: string;
  };
};

function normalizeMemoryNote(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const note = value.trim();
  if (note.length > 1500) throw new Error("기억 내용이 너무 깁니다.");
  if (
    /(?:sk-[a-zA-Z0-9_-]{10,}|Bearer\s+\S+|-----BEGIN .*PRIVATE KEY|(?:비밀번호|password|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\s*[:=])/i.test(
      note
    )
  ) {
    return null;
  }
  return note;
}

// 도구 인자에 대상 에이전트를 받지 않고 현재 사용자 발언에 근거한 메모만 허용합니다.
export function parseMemoryToolNote(raw: string, userText: string): string {
  const args: unknown = JSON.parse(raw);
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new Error("기억 도구의 입력 형식이 올바르지 않습니다.");
  const item = args as Record<string, unknown>;
  if (
    Object.keys(item).some((key) => key !== "note" && key !== "sourceQuote") ||
    typeof item.sourceQuote !== "string" ||
    !item.sourceQuote.trim() ||
    !userText.includes(item.sourceQuote)
  ) {
    throw new Error("현재 사용자 발언에서 이 기억의 근거를 확인할 수 없습니다.");
  }
  const note = normalizeMemoryNote(item.note);
  if (!note) throw new Error("빈 내용이나 인증 정보는 기억에 저장할 수 없습니다.");
  return note;
}

// 모델이 요청하지 않은 도구나 다른 에이전트 ID를 만들어 내도 실행하지 않습니다.
export function parseManagementPlan(text: string, userText: string): ManagementPlan {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const value: unknown = JSON.parse(cleaned);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("기억·반복 업무 응답 형식 오류");
  const record = value as Record<string, unknown>;
  const memoryNote = normalizeMemoryNote(record.memoryNote);
  let routine: ManagementPlan["routine"] = null;
  if (record.routine != null) {
    if (typeof record.routine !== "object" || Array.isArray(record.routine))
      throw new Error("반복 업무 형식 오류");
    const item = record.routine as Record<string, unknown>;
    const actions = ["save", "pause", "resume", "delete", "run"];
    if (typeof item.action !== "string" || !actions.includes(item.action))
      throw new Error("지원하지 않는 반복 업무 동작입니다.");
    if (
      typeof item.sourceQuote !== "string" ||
      !item.sourceQuote.trim() ||
      !userText.includes(item.sourceQuote)
    )
      throw new Error("현재 요청에 없는 반복 업무 동작입니다.");
    if (
      typeof item.intervalMinutes !== "number" ||
      !Number.isInteger(item.intervalMinutes) ||
      item.intervalMinutes < 5 ||
      item.intervalMinutes > 10080
    )
      throw new Error("반복 간격은 5분에서 7일 사이여야 합니다.");
    if (
      typeof item.instruction !== "string" ||
      item.instruction.length > 4000 ||
      (item.action === "save" && !item.instruction.trim())
    )
      throw new Error("반복 업무 설명이 올바르지 않습니다.");
    routine = {
      action: item.action as NonNullable<ManagementPlan["routine"]>["action"],
      instruction: item.instruction.trim(),
      intervalMinutes: item.intervalMinutes,
      sourceQuote: item.sourceQuote,
    };
  }
  return { memoryNote, routine, google: parseGoogleWorkspaceRequest(record.google, userText) };
}

export function appendMemoryNote(current: string, note: string | null, date: string): string {
  if (!note || current.includes(note)) return current;
  const separator = current && !current.endsWith("\n") ? "\n" : "";
  const next = current + separator + "- " + date + ": " + note;
  if (new TextEncoder().encode(next).length > 24 * 1024)
    throw new Error("기억 저장 공간이 가득 찼습니다. 에이전트의 기억 편집기에서 정리해 주세요.");
  return next;
}
