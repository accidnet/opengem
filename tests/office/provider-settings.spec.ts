import { expect, test } from "@playwright/test";

const oldSettings = {
  providerId: "custom",
  providerKind: "api-key",
  baseUrl: "https://original.example/v1",
  apiKey: "original-test-key",
  model: "custom-model",
};
const newUrl = "https://replacement.example/v1";

for (const newKey of ["", "replacement-test-key"]) {
  test(`사용자 지정 서버를 변경하고 ${newKey ? "새 키로" : "키 없이"} 저장한다`, async ({
    page,
  }) => {
    await page.addInitScript((settings) => {
      const saves: { command: string; input: { apiUrl?: string; apiKey?: string } }[] = [];
      // 설정 창과 저장 로직은 그대로 두고 데스크톱에 전달하는 명령만 기록합니다.
      Object.assign(window, {
        providerSettingsSaves: saves,
        __TAURI_INTERNALS__: {
          invoke: async (
            command: string,
            args: { input: { apiUrl?: string; apiKey?: string } }
          ) => {
            if (command === "get_llm_settings") return settings;
            if (command === "load_operation_mode") return { modes: [] };
            if (command === "save_provider_settings_command" || command === "save_llm_settings") {
              saves.push({ command, input: args.input });
              return { ...settings, baseUrl: args.input.apiUrl, apiKey: args.input.apiKey };
            }
            return [];
          },
        },
      });
    }, oldSettings);

    await page.goto("/");
    await page.getByRole("button", { name: "사용자 메뉴 열기" }).click();
    await page.getByRole("menuitem", { name: "Provider", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Providers" });
    const url = dialog.getByLabel("API URL", { exact: true });
    const key = dialog.getByLabel("API Key", { exact: true });
    await expect(url).toHaveValue(oldSettings.baseUrl);
    await expect(key).toHaveValue(oldSettings.apiKey);
    await url.fill(newUrl);
    await expect(key).toHaveValue("");
    if (newKey) await key.fill(newKey);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();

    const saves = await page.evaluate(() => Reflect.get(window, "providerSettingsSaves"));
    expect(saves).toEqual([
      {
        command: "save_llm_settings",
        input: expect.objectContaining({ providerId: "custom", apiUrl: newUrl }),
      },
    ]);
    expect(saves[0].input.apiKey ?? "").toBe(newKey);
  });
}

for (const previouslyConnected of [false, true]) {
  test(`ChatGPT ${previouslyConnected ? "다시 로그인" : "첫 연결"} 실패 후 재시도하여 연결된 계정을 표시한다`, async ({
    page,
  }) => {
    await page.addInitScript((connected) => {
      const login = {
        phase: "idle" as "idle" | "pending" | "failed" | "succeeded",
        attempt: 0,
        opened: [] as string[],
      };
      Object.assign(window, {
        testChatgptLogin: login,
        __TAURI_INTERNALS__: {
          invoke: async (command: string, args?: { url: string; attemptId: string }) => {
            if (command === "load_operation_mode") return { modes: [] };
            if (command === "get_llm_settings") {
              return {
                providerId: "openai",
                providerKind: "oauth",
                loggedIn: connected || login.phase === "succeeded",
                email: login.phase === "succeeded" ? "tester@example.org" : undefined,
              };
            }
            if (command === "begin_chatgpt_login") {
              if (login.phase !== "pending") login.attempt++;
              login.phase = "pending";
              return {
                attemptId: String(login.attempt),
                authorizationUrl: `https://login.example/${login.attempt}`,
              };
            }
            if (command === "get_chatgpt_login_status") {
              if (args?.attemptId !== String(login.attempt)) throw "이전 로그인 시도입니다.";
              if (login.phase === "failed") throw "브라우저에서 로그인 요청을 거절했습니다.";
              return login.phase;
            }
            if (command === "open_external_url") {
              login.opened.push(args!.url);
              if (login.opened.length === 1) throw "브라우저를 열지 못했습니다.";
            }
            return [];
          },
        },
      });
    }, previouslyConnected);

    await page.goto("/");
    await page.getByRole("button", { name: "사용자 메뉴 열기" }).click();
    await page.getByRole("menuitem", { name: "Provider", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Providers" });
    const start = dialog.getByRole("button", {
      name: previouslyConnected ? "다시 로그인" : "ChatGPT 로그인",
      exact: true,
    });
    const logout = dialog.getByRole("button", { name: "로그아웃", exact: true });
    if (previouslyConnected) {
      await expect(dialog.getByText("연결된 ChatGPT 계정", { exact: true })).toBeVisible();
      await expect(logout).toBeEnabled();
    }
    await start.click();
    await expect(dialog.getByText("브라우저를 열지 못했습니다.")).toBeVisible();
    if (previouslyConnected) await expect(logout).toBeDisabled();
    await dialog.getByRole("button", { name: "로그인 페이지 다시 열기" }).click();
    await expect(dialog.getByText("브라우저를 열지 못했습니다.")).toBeHidden();
    await page.evaluate(() => (Reflect.get(window, "testChatgptLogin").phase = "failed"));
    await expect(dialog.getByText("브라우저에서 로그인 요청을 거절했습니다.")).toBeVisible();
    if (previouslyConnected) await expect(logout).toBeEnabled();

    await start.click();
    await expect(dialog.getByRole("button", { name: "로그인 페이지 다시 열기" })).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, "testChatgptLogin").opened)).toEqual([
      "https://login.example/1",
      "https://login.example/1",
      "https://login.example/2",
    ]);
    await page.evaluate(() => (Reflect.get(window, "testChatgptLogin").phase = "succeeded"));
    await expect(dialog.getByText("tester@example.org")).toBeVisible();
    await expect(logout).toBeEnabled();
  });
}
