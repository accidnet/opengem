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

async function firstCharacterPosition(page: Page) {
  const nameBounds = await label(page).boundingBox();
  const canvasBounds = await page.locator(".office-viewport canvas").boundingBox();
  if (!nameBounds || !canvasBounds) throw new Error("3D 캐릭터의 위치를 확인할 수 없습니다.");
  // 이름표 바로 아래의 머리 부분을 캔버스 좌표로 환산해 실제 메시를 클릭합니다.
  return {
    x: nameBounds.x + nameBounds.width / 2 - canvasBounds.x,
    y: nameBounds.y + nameBounds.height + canvasBounds.height * 0.04 - canvasBounds.y,
  };
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
  const canvas = page.locator(".office-viewport canvas");
  await canvas.dblclick({ position: await firstCharacterPosition(page) });
  await label(page, "office-agent-2").dblclick();
  await rosterAgent(page).dblclick();
  await page.getByRole("button", { name: firstName + " 상세 정보", exact: true }).click();
  await expect(page.getByLabel("상세 콜백", { exact: true })).toHaveText(firstName);
  await expect(page.getByLabel("대화 콜백", { exact: true })).toHaveText("없음");
  await page.getByRole("checkbox", { name: "대화 처리 중" }).uncheck();
  await chatButton.click();
  await expect(page.getByLabel("대화 콜백", { exact: true })).toHaveText(firstName);
});

test("캐릭터와 이름표, 목록에서 더블클릭한 팀원의 대화를 연다", async ({ page }) => {
  await openOffice(page);
  const chat = page.getByLabel("대화 콜백", { exact: true });
  await rosterAgent(page, "Backend").dblclick();
  await expect(chat).toHaveText("Backend");
  await label(page, "office-agent-2").dblclick();
  await expect(chat).toHaveText("Frontend");
  const canvas = page.locator(".office-viewport canvas");
  await canvas.dblclick({ position: await firstCharacterPosition(page) });
  await expect(chat).toHaveText(firstName);
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
  const canvas = page.locator(".office-viewport canvas");
  const canvasBounds = await canvas.boundingBox();
  expect(canvasBounds).not.toBeNull();
  await canvas.click({ position: await firstCharacterPosition(page) });
  await expect(rosterAgent(page)).toHaveAttribute("aria-pressed", "true");
  await canvas.dblclick({ position: { x: 8, y: 8 } });
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
  await expect(page.getByLabel("대화 콜백", { exact: true })).toHaveText("없음");
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

async function sceneImage(page: Page) {
  // 이름표의 높이 변화와 포커스 표시를 제외하고 실제 WebGL 화면을 비교합니다.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  return page.locator(".office-viewport canvas").screenshot({
    style: ".office-agent-labels { visibility: hidden !important; }",
    animations: "disabled",
  });
}

test("선택한 먼작귀 3종을 입체 모델로 표시하고 캐릭터 변경 후에도 위치를 유지한다", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openOffice(page);
  await expect(label(page)).toHaveAttribute("data-avatar-kind", "chiikawa");
  await expect(label(page, "office-agent-2")).toHaveAttribute("data-avatar-kind", "hachiware");
  await expect(label(page, "office-agent-3")).toHaveAttribute("data-avatar-kind", "usagi");
  await page.getByRole("combobox", { name: "팀 규모" }).selectOption("1");
  await rosterAgent(page).click();
  await walk(page);
  await page.keyboard.press("Escape");
  const moved = await position(page);
  expect(moved).not.toBeNull();
  // 재생 중인 걸음과 회전을 초기화한 뒤 외형만 비교합니다.
  await page.getByRole("button", { name: "오피스 다시 열기", exact: true }).click();
  await expect(label(page)).toHaveAttribute("data-avatar-kind", "chiikawa");
  const chiikawa = await sceneImage(page);
  const character = page.getByRole("combobox", { name: "첫 팀원 캐릭터" });
  await character.selectOption("hachiware");
  await expect(label(page)).toHaveAttribute("data-avatar-kind", "hachiware");
  await expect(label(page)).toHaveAttribute("title", "하치와레 · 3D 캐릭터");
  const hachiware = await sceneImage(page);
  expect(hachiware.equals(chiikawa)).toBe(false);
  expect(await position(page)).toEqual(moved);
  await character.selectOption("usagi");
  await expect(label(page)).toHaveAttribute("data-avatar-kind", "usagi");
  await expect(label(page)).toHaveAttribute("title", "우사기 · 3D 캐릭터");
  expect((await sceneImage(page)).equals(hachiware)).toBe(false);
  expect(await position(page)).toEqual(moved);
  await rosterAgent(page).click();
  await walk(page);
  expect(await position(page)).not.toEqual(moved);
  expect(errors).toEqual([]);
});

test("라이브러리 이미지 교체와 삭제를 즉시 반영하고 깨진 이미지는 기본 로봇으로 표시한다", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openOffice(page);
  await page.getByRole("combobox", { name: "팀 규모" }).selectOption("1");
  await expect(label(page)).toHaveAttribute("data-avatar-kind", "chiikawa");
  const original = await sceneImage(page);
  await page.getByRole("button", { name: "캐릭터 이미지 교체", exact: true }).click();
  await expect(label(page)).toHaveAttribute("data-avatar-kind", "image");
  await expect(label(page)).toHaveAttribute("title", "테스트 이미지 · 이미지 기반 3D 캐릭터");
  await expect.poll(async () => (await sceneImage(page)).equals(original)).toBe(false);
  const custom = await sceneImage(page);
  await page.getByRole("button", { name: "치이카와 삭제", exact: true }).click();
  await expect(label(page)).toHaveAttribute("data-avatar-kind", "hachiware");
  await expect(label(page)).toHaveAttribute("title", "하치와레 · 3D 캐릭터");
  expect((await sceneImage(page)).equals(custom)).toBe(false);
  await page.getByRole("button", { name: "캐릭터 라이브러리 비우기", exact: true }).click();
  await expect(label(page)).toHaveAttribute("data-avatar-kind", "robot");
  const robot = await sceneImage(page);
  // 깨진 이미지도 빈 라이브러리와 똑같은 로봇을 실제로 그려야 합니다.
  await page.getByRole("button", { name: "깨진 캐릭터 이미지", exact: true }).click();
  await expect(label(page)).toHaveAttribute("data-avatar-kind", "robot");
  await expect(label(page)).toHaveAttribute("title", "기본 로봇");
  await expect.poll(async () => (await sceneImage(page)).equals(robot)).toBe(true);
  await page.getByRole("button", { name: "캐릭터 이미지 교체", exact: true }).click();
  await expect(label(page)).toHaveAttribute("data-avatar-kind", "image");
  await expect.poll(async () => (await sceneImage(page)).equals(robot)).toBe(false);
  await rosterAgent(page).click();
  await walk(page);
  await expect.poll(() => position(page)).not.toBeNull();
  expect(errors).toEqual([]);
});

test("이미지 로딩 중 오피스를 다시 열고 캐릭터를 바꿔도 늦은 응답이 이전 외형을 되살리지 않는다", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const imagePath = "/tests/office/delayed-character.png";
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#f000cc";
    context.fillRect(0, 0, 64, 64);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  let releaseImage!: () => void;
  const blocked = new Promise<void>((resolve) => {
    releaseImage = resolve;
  });
  let requests = 0;
  await page.route("**/delayed-character.png", async (route) => {
    requests += 1;
    await blocked;
    await route.fulfill({ contentType: "image/png", body: Buffer.from(png, "base64") });
  });
  await page.addInitScript((image) => {
    localStorage.setItem(
      "opengem.characters.v1",
      JSON.stringify([
        { id: "chiikawa", name: "지연 이미지", image },
        { id: "hachiware", name: "하치와레", image: "builtin:hachiware" },
        { id: "usagi", name: "우사기", image: "builtin:usagi" },
      ])
    );
  }, imagePath);
  // 이미지 응답을 보류해야 로딩 중 해제되는 렌더러를 결정적으로 재현할 수 있습니다.
  await page.goto("/tests/office/index.html", { waitUntil: "domcontentloaded" });
  await expect(label(page)).toHaveAttribute("data-avatar-kind", "robot");
  await expect.poll(() => requests).toBeGreaterThan(0);
  await page.getByRole("button", { name: "오피스 다시 열기", exact: true }).click();
  await expect(label(page)).toHaveAttribute("data-avatar-kind", "robot");
  await page.getByRole("combobox", { name: "첫 팀원 캐릭터" }).selectOption("hachiware");
  await expect(label(page)).toHaveAttribute("data-avatar-kind", "hachiware");
  const hachiware = await sceneImage(page);
  const loaded = page.evaluate(
    (source) =>
      new Promise<number>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth);
        image.onerror = () => reject(new Error("지연 이미지 로드 실패"));
        image.src = source;
      }),
    imagePath
  );
  releaseImage();
  expect(await loaded).toBe(64);
  await expect(label(page)).toHaveAttribute("data-avatar-kind", "hachiware");
  await expect(label(page)).toHaveAttribute("title", "하치와레 · 3D 캐릭터");
  expect((await sceneImage(page)).equals(hachiware)).toBe(true);
  // 응답 자체는 정상인지도 확인해 실패한 이미지가 경합을 가리는 일을 막습니다.
  await page.getByRole("combobox", { name: "첫 팀원 캐릭터" }).selectOption("chiikawa");
  await expect(label(page)).toHaveAttribute("data-avatar-kind", "image");
  expect((await sceneImage(page)).equals(hachiware)).toBe(false);
  expect(errors).toEqual([]);
});
