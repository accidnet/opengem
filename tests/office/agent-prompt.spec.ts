import { expect, test } from "@playwright/test";

test("에이전트 상세에서 프롬프트를 추가하고 지운 뒤 다시 열어도 유지한다", async ({ page }) => {
  const original = "팀의 작업을 조율해 줘.";
  const updated = "검토할 항목을 모아 줘.\n중요한 순서대로 알려 줘.";
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.addInitScript((original) => {
    const mode = "Orchestration";
    const agents = [
      { agentId: "lead", name: "조율", role: "main", prompt: original },
      { agentId: "helper", name: "검토", role: "sub", prompt: null },
    ].map((agent) => ({ ...agent, active: true, color: "indigo", icon: "smart_toy" }));
    // 새로고침해도 Tauri 명령이 저장한 데이터만 다시 읽도록 합니다.
    const storageKey = "test-mode-agents";
    let failNextSave = true;
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: { modeName: string; agents: typeof agents }) => {
          if (command === "load_operation_mode") {
            return { modes: [mode], selectedMode: mode, items: [{ name: mode }] };
          }
          if (command === "load_mode_agents" && args.modeName === mode) {
            const saved = sessionStorage.getItem(storageKey);
            return saved ? JSON.parse(saved) : agents;
          }
          if (command === "save_mode_agents" && args.modeName === mode) {
            if (failNextSave) {
              failNextSave = false;
              throw new Error("저장 실패");
            }
            sessionStorage.setItem(storageKey, JSON.stringify(args.agents));
            return;
          }
          if (command === "get_llm_settings") return {};
          return [];
        },
      },
    });
  }, original);

  const openDetail = async (name: string) => {
    await page
      .getByLabel("에이전트 목록", { exact: true })
      .getByRole("button", { name: name + " 선택", exact: true })
      .click();
    await page.getByRole("button", { name: name + " 상세 정보", exact: true }).click();
    return page.getByRole("complementary", { name: name + " 상세 정보" });
  };
  await page.goto("/");
  const lead = await openDetail("조율");
  const leadPrompt = lead.getByRole("textbox", { name: "프롬프트", exact: true });
  await expect(leadPrompt).toHaveValue(original);
  await leadPrompt.fill("저장하지 않은 초안");

  const helper = await openDetail("검토");
  const helperPrompt = helper.getByRole("textbox", { name: "프롬프트", exact: true });
  await expect(helperPrompt).toHaveValue("");
  await helperPrompt.fill(updated);
  const saveHelper = helper.getByRole("button", { name: "저장", exact: true });
  await saveHelper.click();
  await expect(helper.getByRole("alert")).toContainText("저장하지 못했습니다");
  await expect(helperPrompt).toHaveValue(updated);
  await saveHelper.click();
  await expect(saveHelper).toBeDisabled();

  await openDetail("조율");
  await expect(leadPrompt).toHaveValue(original);
  await leadPrompt.fill("");
  const saveLead = lead.getByRole("button", { name: "저장", exact: true });
  await saveLead.click();
  await expect(saveLead).toBeDisabled();

  await page.reload();
  await openDetail("조율");
  await expect(leadPrompt).toHaveValue("");
  await openDetail("검토");
  await expect(helperPrompt).toHaveValue(updated);
});
