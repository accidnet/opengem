import type { LLMMessage } from "@/lib/llm/types";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function validatedImages(message: LLMMessage) {
  if (message.images === undefined) return [];
  if (!Array.isArray(message.images)) throw new Error("화면 이미지 목록 형식이 올바르지 않습니다.");
  if (message.images.length && message.role !== "user")
    throw new Error("화면 이미지는 사용자 메시지에서만 전달할 수 있습니다.");
  return message.images.map((image) => {
    if (!image || (image.mimeType !== "image/png" && image.mimeType !== "image/jpeg"))
      throw new Error("화면 이미지는 PNG 또는 JPEG 형식이어야 합니다.");
    const data = image.data;
    if (
      typeof data !== "string" ||
      !data.length ||
      data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
    )
      throw new Error("화면 이미지가 비어 있거나 6 MiB 제한을 넘었습니다.");
    if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
      throw new Error("화면 이미지의 base64 형식이 올바르지 않습니다.");
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    const last = BASE64_ALPHABET.indexOf(data[data.length - padding - 1]);
    if ((padding === 2 && last % 16 !== 0) || (padding === 1 && last % 4 !== 0))
      throw new Error("화면 이미지의 base64 끝부분이 올바르지 않습니다.");
    const byteLength = (data.length / 4) * 3 - padding;
    if (byteLength > MAX_IMAGE_BYTES) throw new Error("화면 이미지가 6 MiB 제한을 넘었습니다.");
    const header = atob(data.slice(0, 16));
    const signature =
      image.mimeType === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255];
    if (!signature.every((byte, index) => header.charCodeAt(index) === byte))
      throw new Error("화면 이미지의 실제 형식과 MIME 형식이 일치하지 않습니다.");
    return { ...image, byteLength };
  });
}

// system 분리 전에 전체 메시지를 검사해 이미지가 조용히 버려지지 않게 합니다.
export function validateMessageImages(messages: LLMMessage[]): void {
  let totalBytes = 0;
  for (const message of messages) {
    for (const image of validatedImages(message)) totalBytes += image.byteLength;
    if (totalBytes > MAX_IMAGE_BYTES)
      throw new Error("한 요청의 화면 이미지 합계는 6 MiB 이하여야 합니다.");
  }
}

export function buildOpenAIImageMessage(message: LLMMessage) {
  const images = validatedImages(message);
  return {
    role: message.role,
    content: [
      { type: message.role === "assistant" ? "output_text" : "input_text", text: message.content },
      ...images.map((image) => ({
        type: "input_image",
        image_url: `data:${image.mimeType};base64,${image.data}`,
        detail: "auto",
      })),
    ],
  };
}

export function buildAnthropicImageMessage(message: LLMMessage) {
  const images = validatedImages(message);
  return {
    role: message.role,
    content: [
      { type: "text", text: message.content },
      ...images.map((image) => ({
        type: "image",
        source: { type: "base64", media_type: image.mimeType, data: image.data },
      })),
    ],
  };
}

export function buildGeminiImageMessage(message: LLMMessage) {
  const images = validatedImages(message);
  return {
    role: message.role === "assistant" ? "model" : "user",
    parts: [
      { text: message.content },
      ...images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } })),
    ],
  };
}

export function imageRequestError(provider: string, status: number): Error {
  // 공급자 오류가 이미지를 되돌려 주더라도 로그나 대화에 복사하지 않습니다.
  return new Error(
    `${provider} 이미지 요청에 실패했습니다 (${status}). 선택한 모델의 이미지 지원과 연결 설정을 확인해 주세요.`
  );
}
