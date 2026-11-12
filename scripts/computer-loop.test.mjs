import assert from "node:assert/strict";
import test from "node:test";
import { parseComputerPlan } from "../src/features/computer/plan.ts";
import { executeComputerLoop } from "../src/features/computer/engine.ts";

const click = { kind: "click", x: 10, y: 20, button: "left", clickCount: 1 };
const plan = (action = click, requiresConfirmation = false) =>
  JSON.stringify({
    kind: "action",
    action,
    reason: "선택한 버튼 누르기",
    requiresConfirmation,
  });
const done = JSON.stringify({ kind: "done", message: "현재 화면에서 완료를 확인했습니다." });
const observation = (id = "one") => ({
  sessionId: "session",
  observationId: id,
  width: 800,
  height: 600,
  imageDataUrl: "data:image/png;base64,test",
  windowTitle: "테스트",
  capturedAt: Date.now(),
});
function fixture(responses = [plan(), done]) {
  const controller = new AbortController();
  const calls = { act: [], review: [], propose: [] };
  const deps = {
    observe: async () => observation(),
    propose: async (screen, history) => {
      calls.propose.push({ screen, history });
      return { text: responses.shift() ?? done, totalTokens: 5 };
    },
    review: async (screen, action) => {
      calls.review.push({ screen, action });
      return true;
    },
    act: async (screen, action) => {
      calls.act.push({ screen, action });
      return observation("next-" + calls.act.length);
    },
    progress: () => {},
  };
  return { controller, calls, deps };
}

test("허용한 단일 동작과 최신 화면 범위만 해석한다", () => {
  assert.deepEqual(parseComputerPlan(plan(), 800, 600).action, click);
  assert.throws(() => parseComputerPlan(plan({ ...click, x: 800 }), 800, 600));
  assert.throws(() => parseComputerPlan(plan({ ...click, y: -1 }), 800, 600));
  assert.throws(() => parseComputerPlan(plan({ ...click, x: 1.2 }), 800, 600));
  assert.throws(() => parseComputerPlan(plan({ ...click, windowId: "other" }), 800, 600));
  assert.throws(() => parseComputerPlan(plan({ kind: "shell", command: "anything" }), 800, 600));
  assert.throws(() =>
    parseComputerPlan(
      JSON.stringify({ kind: "action", action: click, reason: "확인 누락" }),
      800,
      600
    )
  );
});
test("키 조합·문자·대기·스크롤의 입력 한도를 검증한다", () => {
  assert.throws(() => parseComputerPlan(plan({ kind: "key", key: "Win+R" }), 800, 600));
  assert.throws(() => parseComputerPlan(plan({ kind: "type", text: "x".repeat(2001) }), 800, 600));
  assert.throws(() => parseComputerPlan(plan({ kind: "type", text: "\u0000" }), 800, 600));
  assert.throws(() => parseComputerPlan(plan({ kind: "wait", durationMs: 999999 }), 800, 600));
  assert.throws(() => parseComputerPlan(plan({ kind: "scroll", x: 1, y: 1, deltaY: 0 }), 800, 600));
  assert.equal(
    parseComputerPlan(plan({ kind: "type", text: "한글 입력" }), 800, 600).action.text,
    "한글 입력"
  );
});
test("기본 모드는 동작 검토 후 최신 관찰로 다음 단계를 요청한다", async () => {
  const f = fixture();
  const result = await executeComputerLoop(
    { automatic: false, signal: f.controller.signal },
    f.deps
  );
  assert.equal(f.calls.review.length, 1);
  assert.equal(f.calls.act.length, 1);
  assert.equal(f.calls.propose[1].screen.observationId, "next-1");
  assert.equal(f.calls.propose[1].history.length, 1);
  assert.equal(result.totalTokens, 10);
  assert.equal(result.steps, 1);
});
test("자동 실행에서도 민감한 동작의 검토를 생략하지 않는다", async () => {
  const f = fixture([plan(click, true), done]);
  f.deps.review = async () => false;
  const result = await executeComputerLoop(
    { automatic: true, signal: f.controller.signal },
    f.deps
  );
  assert.equal(f.calls.act.length, 0);
  assert.match(result.text, /실행하지 않고/);
});
test("모델 응답 대기 중 중지하면 돌아온 동작을 실행하지 않는다", async () => {
  const f = fixture();
  f.deps.propose = async () => {
    f.controller.abort();
    return { text: plan(), totalTokens: 1 };
  };
  await assert.rejects(
    executeComputerLoop({ automatic: true, signal: f.controller.signal }, f.deps),
    /중지/
  );
  assert.equal(f.calls.act.length, 0);
});
test("검토 중 중지하면 늦게 도착한 승인을 실행하지 않는다", async () => {
  const f = fixture();
  f.deps.review = async () => {
    f.controller.abort();
    return true;
  };
  await assert.rejects(
    executeComputerLoop({ automatic: false, signal: f.controller.signal }, f.deps),
    /중지/
  );
  assert.equal(f.calls.act.length, 0);
});
test("모델이 임의 도구 호출을 반환하면 입력을 실행하지 않는다", async () => {
  const f = fixture();
  f.deps.propose = async () => ({ text: plan(), totalTokens: 1, hasToolCalls: true });
  await assert.rejects(
    executeComputerLoop({ automatic: true, signal: f.controller.signal }, f.deps),
    /허용하지 않은/
  );
  assert.equal(f.calls.act.length, 0);
});
test("실패한 입력을 재시도하지 않고 단계 상한도 넘기지 않는다", async () => {
  const failed = fixture();
  let tries = 0;
  failed.deps.act = async () => {
    tries++;
    throw new Error("포커스 변경");
  };
  await assert.rejects(
    executeComputerLoop({ automatic: true, signal: failed.controller.signal }, failed.deps),
    /포커스/
  );
  assert.equal(tries, 1);
  const limited = fixture([plan(), plan(), done]);
  const result = await executeComputerLoop(
    { automatic: true, signal: limited.controller.signal, maxSteps: 1 },
    limited.deps
  );
  assert.equal(limited.calls.act.length, 1);
  assert.match(result.text, /1단계/);
});

test("검토 중 만료된 관찰과 승인은 폐기하고 새 화면을 다시 검토한다", async () => {
  const f = fixture([plan(), plan({ ...click, x: 30 }), done]);
  let clock = 0;
  let observes = 0;
  let reviews = 0;
  f.deps.observe = async () => ({ ...observation("fresh-" + ++observes), capturedAt: clock });
  f.deps.review = async () => {
    reviews++;
    if (reviews === 1) clock = 56_000;
    return true;
  };
  f.deps.act = async (screen, action) => {
    f.calls.act.push({ screen, action });
    return { ...observation("after"), capturedAt: clock };
  };
  await executeComputerLoop(
    { automatic: false, signal: f.controller.signal, now: () => clock },
    f.deps
  );
  assert.equal(observes, 2);
  assert.equal(reviews, 2);
  assert.equal(f.calls.act.length, 1);
  assert.equal(f.calls.act[0].screen.observationId, "fresh-2");
  assert.equal(f.calls.act[0].action.x, 30);
});
