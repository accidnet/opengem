import type { LLMToolCall, LLMToolDefinition } from "@/features/ai";

// 공급자가 도구 정의를 무시하더라도, 이번 요청에 공개한 도구만 실행합니다.
export function getPermittedToolCalls(
  toolCalls: LLMToolCall[] | undefined,
  definitions: LLMToolDefinition[]
): LLMToolCall[] {
  const calls = toolCalls?.filter((call) => call.name.trim().length > 0) ?? [];
  const allowed = new Set(definitions.map((tool) => tool.function.name));
  if (calls.some((call) => !allowed.has(call.name))) {
    throw new Error("이 대화에서 허용하지 않은 도구 호출을 차단했습니다. 요청을 다시 보내 주세요.");
  }
  return calls;
}
