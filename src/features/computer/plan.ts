import type { ComputerAction } from "./api";

export type ComputerPlan =
  | { kind: "done" | "handoff"; message: string }
  | { kind: "action"; action: ComputerAction; reason: string; requiresConfirmation: boolean };

const KEYS = new Set([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Ctrl+A",
  "Ctrl+C",
  "Ctrl+V",
  "Ctrl+X",
  "Ctrl+Z",
  "Ctrl+F",
  "Ctrl+S",
  "Ctrl+L",
]);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("컴퓨터 동작 응답 형식을 확인할 수 없습니다.");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("지원하지 않는 컴퓨터 동작 항목이 있습니다.");
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("컴퓨터 동작의 설명 또는 입력 길이가 올바르지 않습니다.");
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error("컴퓨터 동작의 좌표 또는 범위가 올바르지 않습니다.");
  return value;
}

// 모델이 준 세션·창 ID는 받지 않고, 관찰한 창 안의 한 동작만 허용합니다.
export function parseComputerPlan(raw: string, width: number, height: number): ComputerPlan {
  if (raw.length > 32000) throw new Error("컴퓨터 동작 응답이 너무 깁니다.");
  integer(width, 1, 16384);
  integer(height, 1, 16384);
  const source = raw.trim().replace(/^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/, "$1");
  const plan = object(JSON.parse(source));
  if (plan.kind === "done" || plan.kind === "handoff") {
    keys(plan, ["kind", "message"]);
    return { kind: plan.kind, message: text(plan.message, 6000) };
  }
  keys(plan, ["kind", "action", "reason", "requiresConfirmation"]);
  if (plan.kind !== "action" || typeof plan.requiresConfirmation !== "boolean")
    throw new Error("컴퓨터 동작과 확인 여부가 명확하지 않습니다.");
  const item = object(plan.action);
  let action: ComputerAction;
  switch (item.kind) {
    case "click":
      keys(item, ["kind", "x", "y", "button", "clickCount"]);
      if (item.button !== "left" && item.button !== "right")
        throw new Error("지원하지 않는 마우스 버튼입니다.");
      action = {
        kind: "click",
        x: integer(item.x, 0, width - 1),
        y: integer(item.y, 0, height - 1),
        button: item.button,
        clickCount: integer(item.clickCount, 1, 2) as 1 | 2,
      };
      break;
    case "type":
      keys(item, ["kind", "text"]);
      if (typeof item.text !== "string" || !item.text.length || item.text.length > 2000)
        throw new Error("입력할 텍스트는 1~2,000자로 지정해 주세요.");
      action = { kind: "type", text: item.text };
      if (
        Array.from(action.text).some((character) => {
          const code = character.charCodeAt(0);
          return (code < 32 && ![9, 10, 13].includes(code)) || (code >= 127 && code <= 159);
        })
      )
        throw new Error("입력할 수 없는 제어 문자가 있습니다.");
      break;
    case "key":
      keys(item, ["kind", "key"]);
      if (typeof item.key !== "string" || !KEYS.has(item.key))
        throw new Error("지원하지 않는 키 조합입니다.");
      action = { kind: "key", key: item.key };
      break;
    case "scroll":
      keys(item, ["kind", "x", "y", "deltaY"]);
      action = {
        kind: "scroll",
        x: integer(item.x, 0, width - 1),
        y: integer(item.y, 0, height - 1),
        deltaY: integer(item.deltaY, -1200, 1200),
      };
      if (!action.deltaY) throw new Error("스크롤 양은 0일 수 없습니다.");
      break;
    case "wait":
      keys(item, ["kind", "durationMs"]);
      action = { kind: "wait", durationMs: integer(item.durationMs, 50, 2000) };
      break;
    default:
      throw new Error("지원하지 않는 컴퓨터 동작입니다.");
  }
  return {
    kind: "action",
    action,
    reason: text(plan.reason, 1000),
    requiresConfirmation: plan.requiresConfirmation,
  };
}
