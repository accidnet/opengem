import { expect, test } from "@playwright/test";

test("Drive의 OAuth 취소·로그인·해제는 이미 연결된 Gmail을 유지한다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // OAuth 제공자와 OS 자격 증명 저장소 경계만 대체합니다.
  await page.addInitScript(() => {
    const services = ["gmail", "drive", "calendar"].map((service) => ({
      service,
      connected: service === "gmail",
      loginPending: false,
      email: service === "gmail" ? "mail@example.test" : null,
      lastError: null,
    }));
    const settings = {
      clientId: "desktop.apps.googleusercontent.com",
      hasClientSecret: true,
      services,
    };
    const opened: string[] = [];
    Object.assign(window, {
      isTauri: true,
      openedUrls: opened,
      finishDrive: () =>
        Object.assign(services[1], {
          connected: true,
          loginPending: false,
          email: "drive@example.test",
        }),
      __TAURI_INTERNALS__: {
        invoke: async (cmd: string, args?: { service?: string; url?: string }) => {
          const status = services.find((item) => item.service === args?.service);
          switch (cmd) {
            case "load_operation_mode":
              return { modes: [] };
            case "get_llm_settings":
              return {};
            case "get_google_settings":
              return structuredClone(settings);
            case "begin_google_login":
              if (!status) throw new Error("플러그인 ID 누락");
              status.loginPending = true;
              return { authorizationUrl: "https://accounts.example.test/" + status.service };
            case "open_external_url":
              opened.push(args!.url!);
              return;
            case "cancel_google_login":
              status!.loginPending = false;
              return;
            case "disconnect_google_service":
              Object.assign(status!, { connected: false, email: null });
              return structuredClone(settings);
            default:
              return [];
          }
        },
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "작업 공간 도구" })
    .getByRole("button", { name: "플러그인" })
    .click();
  const catalog = page.getByRole("dialog", { name: "플러그인", exact: true });
  await catalog.getByRole("searchbox").fill("drive");
  await expect(catalog.getByRole("button", { name: /Google Calendar/ })).toHaveCount(0);
  await catalog.getByRole("button", { name: /Google Drive/ }).click();
  const drive = page.getByRole("dialog", { name: "Google Drive", exact: true });
  const signIn = drive.getByRole("button", { name: "Google로 로그인" });
  await signIn.click();
  await drive.getByRole("button", { name: "연결 취소" }).click();
  await signIn.click();
  await expect(drive.getByText("브라우저에서 Google 로그인을 완료해 주세요.")).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "openedUrls"))).toEqual([
    "https://accounts.example.test/drive",
    "https://accounts.example.test/drive",
  ]);
  await page.evaluate(() => Reflect.get(window, "finishDrive")());
  await expect(drive.getByText("연결됨 · drive@example.test")).toBeVisible();
  await expect(drive.getByRole("button", { name: "파일 찾기" })).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await drive.getByRole("button", { name: "연결 해제" }).click();
  await expect(signIn).toBeVisible();
  await drive.getByRole("complementary").getByRole("button", { name: "Gmail" }).click();
  await expect(page.getByText("연결됨 · mail@example.test")).toBeVisible();
});
