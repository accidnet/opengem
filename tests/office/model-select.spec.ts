import { expect, test, type Route } from "@playwright/test";

test("사용자 지정 모델은 선택·목록 조회 이후에 변경된 서버 주소와 키를 함께 사용한다", async ({
  page,
}) => {
  await page.goto("/tests/office/index.html");
  const result = await page.evaluate(async () => {
    const model = "team-assistant";
    const providers = [
      {
        providerId: "custom",
        credentialTypes: ["api-key"],
        apiUrls: { "api-key": "https://listed.example.test/v1" },
        hasApiKey: true,
        loggedIn: false,
      },
    ];
    let credential = {
      providerId: "custom",
      credentialType: "api-key",
      baseUrl: "https://current.example.test/v1",
      apiKey: "current-test-key",
    };
    let activeProvider = "custom";
    Reflect.set(window, "__TAURI_INTERNALS__", {
      invoke: async (command: string) => {
        if (command === "resolve_llm_settings")
          return {
            providerId: activeProvider,
            providerKind: "api-key",
            model,
            baseUrl: "https://selected.example.test/v1",
            apiKey: "selected-test-key",
          };
        if (command === "get_available_providers") return providers;
        if (command === "list_provider_models") return [{ id: model, name: model }];
        if (command === "get_provider_credential") return credential;
        throw new Error(command);
      },
    });
    // 대화와 반복 업무가 사용하는 실제 모델 해석 경로에서 세 시점의 설정을 다르게 제공합니다.
    const modulePath = "/src/features/agent/model.ts";
    const { resolveAgentModel } = await import(modulePath);
    const current = await resolveAgentModel(model);
    activeProvider = "openai";
    credential = { ...credential, baseUrl: "http://localhost:8000/v1", apiKey: "" };
    const keyless = await resolveAgentModel(model);
    credential = { ...credential, baseUrl: "", apiKey: "unpaired-test-key" };
    let missingAddressFailed = false;
    try {
      await resolveAgentModel(model);
    } catch {
      missingAddressFailed = true;
    }
    return { current, keyless, missingAddressFailed };
  });
  expect(result.current).toMatchObject({
    baseUrl: "https://current.example.test/v1",
    apiKey: "current-test-key",
  });
  expect(result.keyless).toMatchObject({ baseUrl: "http://localhost:8000/v1", apiKey: "" });
  expect(result.missingAddressFailed).toBe(true);
});

test("빠른 편집에서 저장된 모델 외의 목록을 열고 새로고침한 모델을 선택한다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    // 데스크톱 명령의 응답만 대체하고 실제 빠른 편집 창과 조회 훅을 사용합니다.
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args?: { input?: { credentialType: string } }) => {
          if (command === "get_available_providers") {
            return [
              {
                providerId: "openai",
                credentialTypes: ["oauth"],
                loggedIn: true,
                hasApiKey: false,
                apiUrls: {},
              },
            ];
          }
          if (command === "list_provider_models" && args?.input?.credentialType === "oauth") {
            return (await fetch("/__test__/models")).json();
          }
          if (command === "load_operation_mode") return { modes: [] };
          if (command === "get_llm_settings") return {};
          return [];
        },
      },
    });
  });

  const models = [
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "alternate", name: "Alternate" },
  ];
  await page.route("**/__test__/models", (route) => route.fulfill({ json: models }));
  await page.goto("/");
  await page.getByRole("button", { name: "젬 빠른 설정", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Agent Quick Edit" });
  const input = dialog.getByRole("combobox", { name: "에이전트 quick edit 모델" });
  const list = dialog.getByRole("listbox");
  await expect(input).toHaveValue("gpt-5.4");
  await input.click();
  await expect(list.getByRole("option", { name: /Alternate/ })).toBeVisible();
  await expect(list.getByRole("option", { selected: true })).toContainText("GPT-5.4");

  // 응답이 도착하기 전에도 기존 모델은 선택할 수 있어야 합니다.
  let captureRefresh!: (route: Route) => void;
  const pendingRefresh = new Promise<Route>((resolve) => {
    captureRefresh = resolve;
  });
  await page.route("**/__test__/models", captureRefresh, { times: 1 });
  await dialog.getByRole("button", { name: "모델 목록 새로고침" }).click();
  const refresh = await pendingRefresh;
  await expect(list.getByRole("option", { name: /Alternate/ })).toBeEnabled();
  await expect(dialog.getByRole("status")).toContainText("불러오는 중");
  await refresh.fulfill({ json: [{ id: "updated", name: "Updated model" }] });
  await expect(list.getByRole("option", { name: /Alternate/ })).toHaveCount(0);
  await list.getByRole("option", { name: /Updated model/ }).click();
  await expect(input).toHaveValue("updated");
  await expect(list).toHaveCount(0);

  await input.fill("my-own-model");
  await expect(dialog.getByRole("status")).toContainText("검색 결과가 없습니다");
  await input.press("Enter");
  await expect(input).toHaveValue("my-own-model");
  await input.press("ArrowDown");
  await expect(list.getByRole("option", { name: /Updated model/ })).toBeVisible();

  await page.route("**/__test__/models", (route) => route.abort(), { times: 1 });
  await dialog.getByRole("button", { name: "모델 목록 새로고침" }).click();
  await expect(dialog.getByRole("status")).toContainText("기본 목록");
  await expect(list.getByRole("option").first()).toBeEnabled();
});
