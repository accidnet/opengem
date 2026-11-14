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
