import { expect, test, type Page } from "@playwright/test";

const duePrompt = {
  id: "dev-daily",
  modeName: "개발",
  agentId: "developer",
  title: "개발 진행 요약",
  kind: "prompt",
  instruction: "최근 개발 결정을 정리해 줘.",
  agentName: "개발담당",
  agentModel: "gpt-4o-mini",
  agentPrompt: "개발팀의 기록 담당",
  memory: "배포 전 검토",
  recentConversations: "다음 배포는 목요일로 결정했다.",
  leaseId: "lease-dev-daily",
};

async function openApp(page: Page, native = false, job?: typeof duePrompt) {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.addInitScript(
    ({ native, job }) => {
      const modes = ["기획", "개발"];
      const agent = {
        agentId: "planner",
        name: "기획담당",
        active: true,
        role: "main",
        color: "indigo",
        icon: "smart_toy",
      };
      const provider = {
        providerId: "openai",
        providerKind: "api-key",
        model: "gpt-4.1",
        baseUrl: "https://schedule.example.test/v1",
        apiKey: "fixture-only",
      };
      type Completion = { routineId: string; leaseId: string; report: string; error?: string };
      const completions: Completion[] = [];
      let claimed = false;
      // 브라우저에서는 예약 저장소를 그대로 쓰고, 네이티브 경로에서는 예약별 보고서를 구분합니다.
      Object.assign(window, {
        isTauri: native,
        scheduleCompletions: completions,
        __TAURI_INTERNALS__: {
          invoke: async (
            command: string,
            args?: { id?: string; modeName?: string; input?: Completion }
          ) => {
            switch (command) {
              case "load_operation_mode":
                return {
                  modes,
                  selectedMode: modes[0],
                  items: modes.map((name) => ({ name, projectPaths: [] })),
                };
              case "load_mode_agents":
                if (args?.modeName === modes[0]) return [agent];
                return job ? [{ ...agent, name: job.agentName, agentId: job.agentId }] : [];
              case "get_llm_settings":
              case "resolve_llm_settings":
                return job ? provider : {};
              case "get_available_providers":
                return job
                  ? [
                      {
                        providerId: "openai",
                        credentialTypes: ["api-key"],
                        hasApiKey: true,
                        apiUrls: { "api-key": provider.baseUrl },
                      },
                    ]
                  : [];
              case "list_provider_models":
                return job ? [{ id: job.agentModel, name: job.agentModel }] : [];
              case "get_global_prompt":
                return "한국어로 보고해 주세요.";
              case "claim_due_schedules":
                if (!job || claimed) return [];
                claimed = true;
                return [job];
              case "complete_schedule":
                if (!args?.input) throw new Error("예약 실행 결과 없음");
                completions.push(args.input);
                return;
              case "list_schedules":
                if (job)
                  return [
                    {
                      ...job,
                      intervalMinutes: 1440,
                      enabled: true,
                      nextRunAt: Date.now() + 86400000,
                      lastRunAt: Date.now(),
                      lastError: null,
                    },
                  ];
                return modes.map((modeName) => ({
                  id: modeName,
                  modeName,
                  agentId: null,
                  title: "주간 보고",
                  instruction: "진행 상황을 요약해 줘.",
                  kind: "prompt",
                  intervalMinutes: 10080,
                  enabled: true,
                  nextRunAt: Date.now() + 3600000,
                  lastRunAt: Date.now(),
                  lastError: null,
                }));
              case "list_schedule_reports":
                if (job)
                  return completions
                    .filter((item) => item.routineId === args?.id)
                    .map((item) => ({
                      id: item.leaseId,
                      routineId: item.routineId,
                      status: item.error ? "error" : "success",
                      content: item.report,
                      createdAt: Date.now(),
                    }));
                return [
                  {
                    id: "report-" + args?.id,
                    status: "success",
                    content: args?.id + " 보고 내용",
                    createdAt: Date.now(),
                  },
                ];
              default:
                return [];
            }
          },
        },
      });
    },
    { native, job }
  );
  await page.goto("/");
  await expect(
    page.locator(".office-roster").getByRole("button", { name: "기획담당 선택" })
  ).toBeVisible();
}

const globalSchedules = (page: Page) =>
  page
    .getByRole("navigation", { name: "작업 공간 도구" })
    .getByRole("button", { name: "예약", exact: true });

test("모드와 에이전트에서 만든 예약을 각각 찾고 수정·일시 정지·재개·삭제한다", async ({ page }) => {
  await openApp(page);
  await globalSchedules(page).click();
  const dialog = page.getByRole("dialog", { name: "예약", exact: true });
  const button = (name: string) => dialog.getByRole("button", { name, exact: true });
  await button("새 작업").click();
  await dialog.getByLabel("오퍼레이션 모드").selectOption("개발");
  await expect(dialog.getByLabel("실행 대상")).toHaveValue("");
  await dialog.getByLabel("작업 이름").fill("개발 전체 점검");
  await dialog.getByLabel("맡길 일").fill("팀에서 결정한 사항을 정리해 줘.");
  await button("예약 저장").click();
  await expect(dialog.getByText("개발 · 모드 전체", { exact: true }).last()).toBeVisible();
  await expect(dialog.getByText("아직 실행 기록이 없어요.")).toBeVisible();
  await button("닫기").click();

  await page.locator(".office-roster").getByRole("button", { name: "기획담당 선택" }).click();
  await page.getByRole("button", { name: "기획담당 상세 정보" }).click();
  await page
    .getByRole("group", { name: "에이전트 기록 보기" })
    .getByRole("button", { name: "예약" })
    .click();
  await expect(dialog.getByLabel("모드 필터")).toHaveValue("기획");
  await expect(dialog.getByLabel("에이전트 필터")).toHaveValue("planner");
  await expect(dialog.getByRole("button", { name: /개발 전체 점검/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: /오늘의 업무 정리/ }).click();
  await expect(dialog.getByLabel("실행 대상")).toHaveValue("planner");
  await expect(dialog.getByLabel("맡길 일")).not.toBeEmpty();
  await button("예약 저장").click();
  await expect(dialog.getByRole("heading", { name: "오늘의 업무 정리" })).toBeVisible();
  await expect(dialog.getByLabel("에이전트 필터")).toHaveValue("planner");
  await expect(dialog.getByRole("button", { name: /개발 전체 점검/ })).toHaveCount(0);
  await button("수정").click();
  await dialog.getByLabel("작업 이름").fill("오전 기획 점검");
  await dialog.getByRole("combobox", { name: "반복", exact: true }).selectOption("60");
  await button("예약 저장").click();
  await expect(dialog.getByRole("heading", { name: "오전 기획 점검" })).toBeVisible();
  await expect(dialog.getByText("매시간", { exact: true })).toBeVisible();
  await button("일시 정지").click();
  await expect(button("재개")).toBeEnabled();
  await page.reload();
  await globalSchedules(page).click();
  await dialog.getByRole("button", { name: /오전 기획 점검/ }).click();
  await button("재개").click();
  await expect(button("일시 정지")).toBeEnabled();
  page.once("dialog", (confirmation) => confirmation.accept());
  await button("삭제").click();
  await expect(dialog.getByRole("button", { name: /오전 기획 점검/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /개발 전체 점검/ })).toBeVisible();
});

test("같은 이름의 다른 모드 예약은 각자의 실행 기록을 연다", async ({ page }) => {
  await openApp(page, true);
  await globalSchedules(page).click();
  const dialog = page.getByRole("dialog", { name: "예약", exact: true });
  await dialog.getByRole("button", { name: /주간 보고.*기획/ }).click();
  await expect(dialog.getByText("기획 보고 내용")).toBeVisible();
  await dialog.getByRole("button", { name: /주간 보고.*개발/ }).click();
  await expect(dialog.getByText("개발 보고 내용")).toBeVisible();
  await expect(dialog.getByText("기획 보고 내용")).toHaveCount(0);
});

test("다른 모드 에이전트의 예약을 실행하고 알림에서 저장된 모델 결과를 연다", async ({ page }) => {
  const report = "다음 배포는 목요일이며 배포 전 검토가 필요합니다.";
  const requests: {
    model: string;
    instructions: string;
    input: { role: string; content: { text: string }[] }[];
  }[] = [];
  await page.route("https://schedule.example.test/v1/responses", async (route) => {
    requests.push(route.request().postDataJSON());
    const events = [
      { type: "response.output_text.delta", delta: report },
      { type: "response.completed", response: { status: "completed", output: [] } },
    ];
    await route.fulfill({
      contentType: "text/event-stream",
      body: events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join(""),
    });
  });
  await openApp(page, true, duePrompt);
  const notice = page.getByRole("status").filter({ hasText: "예약한 작업을 완료했습니다." });
  await expect(notice).toContainText(duePrompt.agentName);
  expect(requests).toHaveLength(1);
  const [request] = requests;
  expect(request.model).toBe(duePrompt.agentModel);
  expect(request.instructions).toContain("한국어로 보고해 주세요.");
  expect(JSON.parse(request.input[0].content[0].text)).toMatchObject({
    modeName: duePrompt.modeName,
    agentName: duePrompt.agentName,
    persona: duePrompt.agentPrompt,
    instruction: duePrompt.instruction,
    memory: duePrompt.memory,
    recentConversations: duePrompt.recentConversations,
  });
  expect(await page.evaluate(() => Reflect.get(window, "scheduleCompletions"))).toEqual([
    { routineId: duePrompt.id, leaseId: duePrompt.leaseId, report },
  ]);
  await notice.getByRole("button", { name: "실행 기록 보기" }).click();
  const dialog = page.getByRole("dialog", { name: "예약", exact: true });
  await expect(dialog.getByRole("heading", { name: duePrompt.title })).toBeVisible();
  await expect(dialog.getByText(report, { exact: true })).toBeVisible();
});
