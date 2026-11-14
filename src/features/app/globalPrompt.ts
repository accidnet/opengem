import { invoke, isTauri } from "@tauri-apps/api/core";

const browserStorageKey = "opengem.global-prompt.v1";

export const DEFAULT_GLOBAL_PROMPT =
  "에이전트는 사용자가 직접 알려 준 선호, 작업 방식, 확정된 결정 중 다음 대화에도 필요한 내용을 앱의 기억 저장 기능을 사용해 자신의 MEMORY.md에 짧게 기록하세요. 이미 기록한 내용은 반복하지 말고, 사용자가 정정한 사항은 무엇이 바뀌었는지 명확히 적으세요. 비밀번호, 인증 정보, 일시적인 대화 내용은 기록하지 마세요.";

export async function getGlobalPrompt(): Promise<string> {
  const saved = isTauri()
    ? await invoke<string | null>("get_global_prompt")
    : localStorage.getItem(browserStorageKey);
  // 저장한 적이 없을 때만 기본값을 사용해 사용자가 비워 둔 지침도 유지합니다.
  return saved ?? DEFAULT_GLOBAL_PROMPT;
}

export async function saveGlobalPrompt(prompt: string): Promise<void> {
  if (isTauri()) {
    await invoke("save_global_prompt", { prompt });
  } else {
    localStorage.setItem(browserStorageKey, prompt);
  }
}
