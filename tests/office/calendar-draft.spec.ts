import { expect, test, type Page } from "@playwright/test";

const target = (page: Page) => page.getByRole("combobox", { name: "등록할 캘린더" });
const submit = (page: Page) => page.getByRole("button", { name: "검토한 일정 등록" });
const submissions = (page: Page) => page.evaluate(() => Reflect.get(window, "calendarTestCalls"));

async function openDraft(page: Page, query = "") {
  await page.goto("/tests/office/calendar-fixture.html" + query);
  await expect(target(page)).toBeEnabled();
}

test("목록 밖 초안은 실제 ID를 표시하고 대상 확인 전 등록을 차단한다", async ({ page }) => {
  await openDraft(page);
  await expect(target(page)).toHaveValue("later-calendar");
  await expect(target(page).locator("option:checked")).toHaveText(
    "확인하지 못한 캘린더: later-calendar"
  );
  await expect(submit(page)).toBeDisabled();
  // Enter나 폼 직접 제출로 버튼의 disabled 속성을 우회해도 쓰기 요청을 보내지 않습니다.
  await page.locator("form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
  await expect(page.getByRole("alert").first()).toContainText(
    "초안의 캘린더를 아직 확인하지 못했어요"
  );
  expect(await submissions(page)).toEqual([]);
  await page.getByRole("button", { name: "캘린더 더 불러오기" }).click();
  await expect(target(page).locator("option:checked")).toHaveText("추가 페이지 캘린더");
  await expect(submit(page)).toBeEnabled();
  await submit(page).click();
  await expect(page.getByText("일정을 등록했어요.", { exact: true })).toBeVisible();
  expect(
    (await submissions(page)).map((input: { calendarId: string }) => input.calendarId)
  ).toEqual(["later-calendar"]);
});

test("미확인 대상을 사용자가 확인된 캘린더로 변경하면 그 대상에 등록한다", async ({ page }) => {
  await openDraft(page);
  await target(page).selectOption("listed-calendar");
  await expect(submit(page)).toBeEnabled();
  await submit(page).click();
  await expect(page.getByText("일정을 등록했어요.", { exact: true })).toBeVisible();
  expect(
    (await submissions(page)).map((input: { calendarId: string }) => input.calendarId)
  ).toEqual(["listed-calendar"]);
});

test("추가 페이지의 읽기 전용 캘린더는 표시하되 등록을 허용하지 않는다", async ({ page }) => {
  await openDraft(page, "?accessRole=reader");
  await page.getByRole("button", { name: "캘린더 더 불러오기" }).click();
  await expect(target(page).locator("option:checked")).toHaveText("추가 페이지 캘린더 (읽기 전용)");
  await expect(submit(page)).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("등록할 권한이 없어요");
  expect(await submissions(page)).toEqual([]);
});

test("기본 캘린더 초안은 목록 페이지와 무관하게 등록할 수 있다", async ({ page }) => {
  await openDraft(page, "?calendarId=primary");
  await expect(target(page).locator("option:checked")).toHaveText("기본 캘린더");
  await expect(submit(page)).toBeEnabled();
  await submit(page).click();
  await expect(page.getByText("일정을 등록했어요.", { exact: true })).toBeVisible();
  expect(
    (await submissions(page)).map((input: { calendarId: string }) => input.calendarId)
  ).toEqual(["primary"]);
});

test("등록 직전 계정이 바뀌면 확인된 캘린더에도 등록하지 않는다", async ({ page }) => {
  await openDraft(page, "?calendarId=primary");
  await page.evaluate(() => Reflect.set(window, "calendarTestAccount", "changed@example.test"));
  await submit(page).click();
  await expect(page.getByRole("alert")).toContainText("Calendar 계정이 변경되었습니다");
  expect(await submissions(page)).toEqual([]);
});
