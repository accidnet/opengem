import type { ComputerAction, ComputerObservation } from "./api";
import type { ComputerPlan } from "./plan";
import { parseComputerPlan } from "./plan.ts";

type Dependencies = {
  observe: () => Promise<ComputerObservation>;
  propose: (
    observation: ComputerObservation,
    history: string[]
  ) => Promise<{ text: string; totalTokens: number; hasToolCalls?: boolean }>;
  review: (
    observation: ComputerObservation,
    plan: Extract<ComputerPlan, { kind: "action" }>
  ) => Promise<boolean>;
  act: (observation: ComputerObservation, action: ComputerAction) => Promise<ComputerObservation>;
  progress: (step: number, description: string) => void;
};
function checkStopped(signal: AbortSignal) {
  if (signal.aborted) throw new Error("컴퓨터 제어를 중지했습니다.");
}

// 모델 호출·승인·네이티브 입력을 분리하여 중지된 응답과 오래된 관찰을 재사용하지 않습니다.
export async function executeComputerLoop(
  input: {
    automatic: boolean;
    signal: AbortSignal;
    maxSteps?: number;
    now?: () => number;
  },
  deps: Dependencies
): Promise<{ text: string; totalTokens: number; steps: number }> {
  const maxSteps = Number.isSafeInteger(input.maxSteps)
    ? Math.max(1, Math.min(12, input.maxSteps!))
    : 12;
  const history: string[] = [];
  let totalTokens = 0;
  let steps = 0;
  let refreshes = 0;
  const now = input.now ?? Date.now;
  checkStopped(input.signal);
  let observation = await deps.observe();
  checkStopped(input.signal);
  const refreshIfStale = async () => {
    if (now() - observation.capturedAt <= 55_000) return false;
    if (++refreshes > 3)
      throw new Error(
        "화면 확인 시간이 오래 걸려 중지했습니다. 현재 화면과 모델을 확인한 뒤 다시 요청해 주세요."
      );
    deps.progress(steps, "화면 관찰이 오래되어 다시 확인하고 있어요.");
    observation = await deps.observe();
    checkStopped(input.signal);
    return true;
  };
  while (true) {
    deps.progress(steps, "선택한 창의 화면을 확인하고 있어요.");
    const response = await deps.propose(observation, [...history]);
    totalTokens += response.totalTokens;
    checkStopped(input.signal);
    if (response.hasToolCalls)
      throw new Error("컴퓨터 제어에서 허용하지 않은 도구 호출을 차단했습니다.");
    if (await refreshIfStale()) continue;
    const plan = parseComputerPlan(response.text, observation.width, observation.height);
    if (plan.kind !== "action") {
      return { text: plan.message, totalTokens, steps };
    }
    if (steps >= maxSteps)
      return {
        text:
          "한 번의 요청에서 실행할 수 있는 " +
          maxSteps +
          "단계에 도달해 중지했습니다. 현재 화면을 확인한 뒤 이어서 요청해 주세요.",
        totalTokens,
        steps,
      };
    if (plan.action.kind !== "wait" && (!input.automatic || plan.requiresConfirmation)) {
      deps.progress(steps, "제안한 동작을 확인해 주세요.");
      const accepted = await deps.review(observation, plan);
      checkStopped(input.signal);
      if (!accepted)
        return {
          text: "제안한 동작을 실행하지 않고 컴퓨터 제어를 마쳤습니다.",
          totalTokens,
          steps,
        };
    }
    checkStopped(input.signal);
    // 오래된 화면에 대한 승인은 새 화면에 재사용하지 않습니다.
    if (await refreshIfStale()) continue;
    deps.progress(steps + 1, plan.reason);
    // 불명확한 입력 결과를 자동 재시도하지 않습니다.
    observation = await deps.act(observation, plan.action);
    checkStopped(input.signal);
    steps += 1;
    history.push(String(steps) + ". " + plan.action.kind + ": " + plan.reason.slice(0, 240));
  }
}
