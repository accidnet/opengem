import assert from "node:assert/strict";
import test from "node:test";
import { parseSSEStream } from "../src/features/ai/stream.ts";

test("Responses 함수 인자는 숨기고 사용자에게 전달되는 답변 및 거절 델타는 유지한다", async () => {
  const events = [
    { type: "response.output_text.delta", delta: "답변. " },
    { type: "response.function_call_arguments.delta", delta: '{"note":"기억"}' },
    { type: "response.reasoning_summary_text.delta", delta: "추론 요약" },
    { type: "response.refusal.delta", delta: "이 요청을 처리할 수 없어요." },
    { type: "response.completed", response: { status: "completed", output: [] } },
  ];
  const stream = new Response(events.map((item) => "data: " + JSON.stringify(item)).join("\n\n"));
  const result = await parseSSEStream(stream, "openai-compatible");
  assert.equal(result.text, "답변. 이 요청을 처리할 수 없어요.");
  assert.equal(result.finishReason, "completed");
  assert.equal(result.toolCalls, undefined);
});
