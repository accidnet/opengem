import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

test("직접 업로드한 2D 이미지를 에이전트에 지정하면 3D로 표시하고 브라우저 재접속 후에도 유지한다", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/office/character-upload-fixture.html");
  const label = page.locator('.office-name-tag[data-agent-id="upload-agent"]');
  await expect(label).toBeVisible();
  // 원본 캐릭터 자료 없이 투명 배경에 단순 도형을 직접 그린 PNG를 사용합니다.
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#f000cc";
    context.beginPath();
    context.arc(32, 34, 24, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffffff";
    context.fillRect(20, 27, 7, 7);
    context.fillRect(37, 27, 7, 7);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const name = "직접 업로드한 테스트 캐릭터";
  await page.getByRole("button", { name: "에이전트 설정 열기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Agents", exact: true });
  await dialog.getByLabel("이름", { exact: true }).fill(name);
  await dialog.getByLabel("이미지", { exact: true }).setInputFiles({
    name: "transparent-character.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(dialog.getByRole("img", { name: "선택한 캐릭터 미리보기" })).toBeVisible();
  await dialog.getByRole("button", { name: "캐릭터 추가", exact: true }).click();
  await expect(dialog.getByRole("button", { name: `${name} 수정`, exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: /Agent 목록/ }).click();
  const characterSelect = dialog.getByRole("combobox", {
    name: "업로드 확인 에이전트 캐릭터 변경",
    exact: true,
  });
  await characterSelect.selectOption({ label: name });
  const selectedId = await characterSelect.inputValue();
  expect(selectedId).not.toBe("");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(label).toHaveAttribute("data-avatar-kind", "image");
  await expect(label).toHaveAttribute("title", `${name} · 이미지 기반 3D 캐릭터`);

  await page.reload();
  await expect(label).toHaveAttribute("data-avatar-kind", "image");
  await expect(label).toHaveAttribute("title", `${name} · 이미지 기반 3D 캐릭터`);
  await page.getByRole("button", { name: "에이전트 설정 열기", exact: true }).click();
  await expect(dialog.getByRole("button", { name: `${name} 수정`, exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: /Agent 목록/ }).click();
  await expect(characterSelect).toHaveValue(selectedId);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  expect(errors).toEqual([]);
});
