import { expect, test, type Page } from "@playwright/test";

const storageKey = "opengem.office.positions.v1";
const firstId = "office-agent-1";
const firstName = "Orchestrator";

const rosterAgent = (page: Page, name = firstName) =>
  page.locator(".office-roster").getByRole("button", { name: name + " 선택", exact: true });
const label = (page: Page, id = firstId) =>
  page.locator('.office-viewport [data-agent-id="' + id + '"]');
const position = (page: Page, id = firstId) =>
  page.evaluate(
    ({ key, id }) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw).positions[id] ?? null) : null;
    },
    { key: storageKey, id }
  );

async function openOffice(page: Page) {
  await page.goto("/tests/office/index.html");
  await expect(page.locator(".office-viewport canvas")).toBeVisible();
  await expect(label(page)).toBeVisible();
}

async function walk(page: Page, key = "s") {
  await page.keyboard.down(key);
  // 일정 시간 키를 누르는 실제 이동 동작을 재현합니다.
  await page.waitForTimeout(450);
  await page.keyboard.up(key);
}

test("3D 선택과 이동은 대화 전환 없이 실행되고 재진입 뒤에도 위치가 유지된다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openOffice(page);
  await rosterAgent(page).click();
  await expect(rosterAgent(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("상세 콜백", { exact: true })).toHaveText("없음");
  await expect(page.getByLabel("대화 콜백", { exact: true })).toHaveText("없음");
  const before = await label(page).getAttribute("style");
  await walk(page);
  await expect.poll(() => position(page)).not.toBeNull();
  const moved = await position(page);
  await expect(label(page)).not.toHaveAttribute("style", before ?? "");
  await page.getByRole("button", { name: "오피스 다시 열기", exact: true }).click();
  await expect(label(page)).toBeVisible();
  await expect.poll(() => position(page)).toEqual(moved);
  const restoredStyle = await label(page).getAttribute("style");
  await page.reload();
  await expect(label(page)).toBeVisible();
  await expect.poll(() => position(page)).toEqual(moved);
  await expect(label(page)).toHaveAttribute("style", restoredStyle ?? "");
  expect(errors).toEqual([]);
});

test("다른 입력창·포커스 이탈·Escape에서 키보드 이동을 멈춘다", async ({ page }) => {
  await openOffice(page);
  await rosterAgent(page).click();
  await walk(page);
  await expect.poll(() => position(page)).not.toBeNull();
  await page.getByRole("textbox", { name: "다른 입력창" }).click();
  const stopped = await position(page);
  await page.keyboard.type("wasd");
  await expect(page.getByRole("textbox", { name: "다른 입력창" })).toHaveValue("wasd");
  expect(await position(page)).toEqual(stopped);
  await rosterAgent(page).click();
  await page.keyboard.down("s");
  await page.waitForTimeout(200);
  await page.getByRole("textbox", { name: "다른 입력창" }).click();
  await page.keyboard.up("s");
  const afterBlur = await position(page);
  await page.waitForTimeout(250);
  expect(await position(page)).toEqual(afterBlur);
  await rosterAgent(page).click();
  await page.keyboard.press("Escape");
  await expect(rosterAgent(page)).toHaveAttribute("aria-pressed", "false");
  const afterEscape = await position(page);
  await walk(page);
  expect(await position(page)).toEqual(afterEscape);
});

test("대화와 상세 동작을 분리하고 처리 중 대화 전환을 막는다", async ({ page }) => {
  await openOffice(page);
  await rosterAgent(page).click();
  const chatButton = page.getByRole("button", { name: firstName + "와 대화하기", exact: true });
  await page.getByRole("checkbox", { name: "대화 처리 중" }).check();
  await expect(chatButton).toBeDisabled();
  await page.getByRole("button", { name: firstName + " 상세 정보", exact: true }).click();
  await expect(page.getByLabel("상세 콜백", { exact: true })).toHaveText(firstName);
  await expect(page.getByLabel("대화 콜백", { exact: true })).toHaveText("없음");
  await page.getByRole("checkbox", { name: "대화 처리 중" }).uncheck();
  await chatButton.click();
  await expect(page.getByLabel("대화 콜백", { exact: true })).toHaveText(firstName);
});

test("목록 순서와 팀 규모가 달라져도 에이전트 ID로 선택과 위치를 구분한다", async ({ page }) => {
  await openOffice(page);
  await rosterAgent(page).click();
  await walk(page);
  await expect.poll(() => position(page)).not.toBeNull();
  const moved = await position(page);
  await page.getByRole("button", { name: "목록 순서 바꾸기", exact: true }).click();
  await expect(rosterAgent(page)).toHaveAttribute("aria-pressed", "true");
  expect(await position(page)).toEqual(moved);
  await page.getByRole("combobox", { name: "팀 규모" }).selectOption("12");
  await expect(page.locator(".office-roster button[aria-pressed]")).toHaveCount(12);
  await rosterAgent(page, "Agent 12").click();
  await expect(rosterAgent(page, "Agent 12")).toHaveAttribute("aria-pressed", "true");
  await walk(page, "ArrowDown");
  await expect.poll(() => position(page, "office-agent-12")).not.toBeNull();
  await page.getByRole("combobox", { name: "팀 규모" }).selectOption("0");
  await expect(page.locator(".office-roster button[aria-pressed]")).toHaveCount(0);
  await expect(page.getByText("새로운 팀원을 기다리는 중이에요", { exact: true })).toBeVisible();
});

test("WebGL을 사용할 수 없어도 에이전트 목록과 대화·상세 기능은 남는다", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
        return Reflect.apply(original, this, [type, ...args]);
      },
    });
  });
  await page.goto("/tests/office/index.html");
  await expect(page.getByText(/3D.*(표시|사용|불러)/)).toBeVisible();
  await rosterAgent(page).click();
  await page.getByRole("button", { name: firstName + " 상세 정보", exact: true }).click();
  await expect(page.getByLabel("상세 콜백", { exact: true })).toHaveText(firstName);
  await page.getByRole("button", { name: firstName + "와 대화하기", exact: true }).click();
  await expect(page.getByLabel("대화 콜백", { exact: true })).toHaveText(firstName);
});

test("실제 3D 캐릭터 클릭과 카메라 드래그 후에도 렌더 루프는 하나만 유지된다", async ({ page }) => {
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Set<number>();
    window.requestAnimationFrame = (callback) => {
      const id = request((time) => {
        pending.delete(id);
        callback(time);
      });
      pending.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      pending.delete(id);
      cancel(id);
    };
    Object.defineProperty(window, "officePendingFrames", { get: () => pending.size });
  });
  await openOffice(page);
  const nameBounds = await label(page).boundingBox();
  const canvasBounds = await page.locator(".office-viewport canvas").boundingBox();
  expect(nameBounds).not.toBeNull();
  expect(canvasBounds).not.toBeNull();
  // 이름표 바로 아래의 머리 부분을 클릭해 실제 mesh raycast를 확인합니다.
  await page.mouse.click(
    nameBounds!.x + nameBounds!.width / 2,
    nameBounds!.y + nameBounds!.height + canvasBounds!.height * 0.04
  );
  await expect(rosterAgent(page)).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(
    canvasBounds!.x + canvasBounds!.width * 0.65,
    canvasBounds!.y + canvasBounds!.height * 0.65
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBounds!.x + canvasBounds!.width * 0.55,
    canvasBounds!.y + canvasBounds!.height * 0.55,
    { steps: 12 }
  );
  await page.mouse.up();
  const pendingFrames = () =>
    page.evaluate(() => Reflect.get(window, "officePendingFrames") as number);
  await expect.poll(pendingFrames).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "시점 초기화", exact: true }).click();
  await page.getByRole("button", { name: "오피스 다시 열기", exact: true }).click();
  await expect(label(page)).toBeVisible();
  await expect.poll(pendingFrames).toBeLessThanOrEqual(1);
});

test("손상된 저장 데이터를 무시하고 다음 이동부터 위치를 다시 저장한다", async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "broken-json"), storageKey);
  await openOffice(page);
  await rosterAgent(page).click();
  await walk(page);
  await expect.poll(() => position(page)).not.toBeNull();
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).version, storageKey)
  ).toBe(1);
});

test("WebGL 컨텍스트가 사라지면 안내 화면을 표시하고 다시 시도할 수 있다", async ({ page }) => {
  await openOffice(page);
  await page.locator(".office-viewport canvas").evaluate((element) => {
    const gl = (element as HTMLCanvasElement).getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("WebGL context loss extension unavailable");
    extension.loseContext();
  });
  await expect(page.getByText("3D 화면을 표시할 수 없어요", { exact: true })).toBeVisible();
  await rosterAgent(page).click();
  await page.getByRole("button", { name: firstName + "와 대화하기", exact: true }).click();
  await expect(page.getByLabel("대화 콜백", { exact: true })).toHaveText(firstName);
  await page.getByRole("button", { name: "3D 다시 시도", exact: true }).click();
  await expect(page.getByText("3D 화면을 표시할 수 없어요", { exact: true })).toBeHidden();
  await expect(label(page)).toBeVisible();
  await rosterAgent(page).click();
  await walk(page);
  await expect.poll(() => position(page)).not.toBeNull();
});

test("좁은 화면에서도 오피스와 선택 컨트롤이 가로로 넘치지 않는다", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openOffice(page);
  await rosterAgent(page).click();
  await expect(
    page.getByRole("button", { name: firstName + "와 대화하기", exact: true })
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("office-mobile.png"), fullPage: true });
});
