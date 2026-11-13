import { expect, test } from "@playwright/test";

test("축소하면 사라지는 투명 이미지는 빈 3D 모델을 만들지 않는다", async ({ page }) => {
  await page.goto("/tests/office/index.html");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/pages/chat/components/office/office-image-model.ts";
    const { createImageCharacterMesh } = await import(modulePath);
    // 원본에서는 보이지만 144px로 줄이면 사라지는 불투명 점을 배치합니다.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 768;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    for (const x of [1, 766]) {
      for (const y of [1, 766]) context.fillRect(x, y, 1, 1);
    }
    const image = new Image();
    image.src = canvas.toDataURL("image/png");
    await image.decode();
    try {
      // 윤곽 검사 단계는 GPU 텍스처 없이도 실행할 수 있습니다.
      createImageCharacterMesh(image, undefined);
      return "모델 생성됨";
    } catch (error) {
      return String(error);
    }
  });
  expect(result).toContain("입체화할 이미지 윤곽이 너무 작아요.");
});
