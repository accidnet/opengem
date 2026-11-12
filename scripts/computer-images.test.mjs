import assert from "node:assert/strict";
import test from "node:test";
import {
  validateMessageImages,
  buildOpenAIImageMessage,
  buildAnthropicImageMessage,
  buildGeminiImageMessage,
  imageRequestError,
} from "../src/features/ai/imageMessages.ts";
import { splitSystemMessages } from "../src/features/ai/messages.ts";

const png = {
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
};
const jpeg = { mimeType: "image/jpeg", data: "/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==" };
const message = {
  role: "user",
  content: "현재 창에서 다음 동작을 골라 주세요.",
  images: [png, jpeg],
};

test("OpenAI Responses는 이미지를 텍스트가 아닌 input_image로 전송한다", () => {
  assert.deepEqual(buildOpenAIImageMessage(message), {
    role: "user",
    content: [
      { type: "input_text", text: message.content },
      { type: "input_image", image_url: "data:image/png;base64," + png.data, detail: "auto" },
      { type: "input_image", image_url: "data:image/jpeg;base64," + jpeg.data, detail: "auto" },
    ],
  });
});
test("Anthropic과 Gemini는 해당 공급자의 실제 이미지 content 형식을 사용한다", () => {
  assert.deepEqual(buildAnthropicImageMessage(message), {
    role: "user",
    content: [
      { type: "text", text: message.content },
      { type: "image", source: { type: "base64", media_type: png.mimeType, data: png.data } },
      { type: "image", source: { type: "base64", media_type: jpeg.mimeType, data: jpeg.data } },
    ],
  });
  assert.deepEqual(buildGeminiImageMessage(message), {
    role: "user",
    parts: [
      { text: message.content },
      { inlineData: { mimeType: png.mimeType, data: png.data } },
      { inlineData: { mimeType: jpeg.mimeType, data: jpeg.data } },
    ],
  });
});
test("이미지가 없는 기존 문자열 메시지와 assistant 역할은 바뀌지 않는다", () => {
  const text = { role: "assistant", content: "기존 응답" };
  validateMessageImages([{ role: "system", content: "지침" }, text]);
  assert.deepEqual(buildOpenAIImageMessage(text), {
    role: "assistant",
    content: [{ type: "output_text", text: "기존 응답" }],
  });
  assert.deepEqual(buildAnthropicImageMessage(text), {
    role: "assistant",
    content: [{ type: "text", text: "기존 응답" }],
  });
  assert.deepEqual(buildGeminiImageMessage(text), {
    role: "model",
    parts: [{ text: "기존 응답" }],
  });
});
test("system 분리는 user 이미지를 보존하며 system 이미지는 분리 전에 거절한다", () => {
  const original = [{ role: "system", content: "지침" }, message];
  validateMessageImages(original);
  assert.deepEqual(splitSystemMessages(original), { system: "지침", messages: [message] });
  assert.throws(() => validateMessageImages([{ ...message, role: "system" }]), /사용자 메시지/);
  for (const role of ["assistant", "developer", "tool"]) {
    for (const map of [
      buildOpenAIImageMessage,
      buildAnthropicImageMessage,
      buildGeminiImageMessage,
    ]) {
      assert.throws(() => map({ ...message, role }), /사용자 메시지/);
    }
  }
});
test("잘못된 MIME·base64·서명·목록은 네트워크 요청 전에 거절한다", () => {
  const invalid = [
    { ...png, mimeType: "image/svg+xml" },
    { ...png, data: "" },
    { ...png, data: "data:image/png;base64," + png.data },
    { ...png, data: "a==b" },
    { ...png, data: "abc" },
    { ...png, data: "AA-_" },
    { ...png, data: "AB==" },
    { ...png, data: "AAB=" },
    { ...png, data: "aGVsbG8=" },
    { ...png, mimeType: "image/jpeg" },
  ];
  for (const image of invalid)
    assert.throws(() => validateMessageImages([{ ...message, images: [image] }]));
  assert.throws(() => validateMessageImages([{ ...message, images: "not-an-array" }]));
});
test("6 MiB 개별·요청 합계 경계를 검사한다", () => {
  const payload = Buffer.alloc(6 * 1024 * 1024);
  Buffer.from(png.data, "base64").copy(payload);
  const maxImage = { mimeType: "image/png", data: payload.toString("base64") };
  assert.doesNotThrow(() => validateMessageImages([{ ...message, images: [maxImage] }]));
  assert.throws(() => validateMessageImages([{ ...message, images: [maxImage, png] }]), /합계/);
  assert.throws(
    () =>
      validateMessageImages([
        { ...message, images: [{ ...maxImage, data: maxImage.data + "AAAA" }] },
      ]),
    /6 MiB/
  );
});
test("이미지 요청 실패 안내에는 상태만 포함하고 이미지나 공급자 응답을 복사하지 않는다", () => {
  const error = imageRequestError("OpenAI", 400);
  assert.match(error.message, /400/);
  assert.match(error.message, /이미지 지원/);
  assert.ok(!error.message.includes(png.data));
});
