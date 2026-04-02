import { streamText, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { getProviderCatalog, normalizeBaseUrl, type ProviderProtocol } from "@/data/llmCatalog";
import type { LLMConfig } from "@/types/chat";

export type LLMRole = "user" | "assistant" | "system";

export type LLMMessage = {
  role: LLMRole;
  content: string;
};

export type LLMUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type LLMRequest = {
  providerId?: LLMConfig["providerId"];
  providerKind?: LLMConfig["providerKind"];
  apiBaseUrl: string;
  apiKey?: string;
  accessToken?: string;
  accountId?: string;
  model: string;
  messages: LLMMessage[];
  stream?: boolean;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
  onEvent?: (event: LLMStreamEvent) => void;
};

export type LLMResponse = {
  text: string;
  usage?: LLMUsage;
};

export type LLMStreamEvent = {
  event: string;
  data: string;
  id?: string;
};

type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type GoogleUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

type JsonRecord = Record<string, unknown>;

const DEFAULT_API_BASE_URL = "https://api.openai.com/v1";
const CHATGPT_API_BASE_URL = "https://chatgpt.com/backend-api/codex";

export async function sendToLLM(input: LLMRequest): Promise<LLMResponse> {
  const provider = getProviderCatalog(input.providerId);
  const protocol = provider.protocol;

  if (canUseVercelAiSdk(provider.protocol, provider.sdkTarget)) {
    try {
      return await sendWithVercelAiSdk(input, provider.protocol, provider.sdkTarget);
    } catch (error) {
      console.warn("[opengem] AI SDK path failed, falling back to direct fetch transport.", error);
    }
  }

  if (protocol === "chatgpt-responses" || input.providerKind === "chatgpt_oauth") {
    return sendToChatGptOAuth(input);
  }

  if (protocol === "anthropic") {
    return sendToAnthropic(input);
  }

  if (protocol === "google-gemini") {
    return sendToGemini(input);
  }

  return sendToOpenAICompatible(input);
}

function canUseVercelAiSdk(
  protocol: ProviderProtocol,
  sdkTarget?: "openai" | "openai-compatible" | "native-fetch"
) {
  if (!sdkTarget || sdkTarget === "native-fetch") {
    return false;
  }

  return protocol === "openai-compatible";
}

async function sendWithVercelAiSdk(
  input: LLMRequest,
  protocol: ProviderProtocol,
  sdkTarget?: "openai" | "openai-compatible" | "native-fetch"
): Promise<LLMResponse> {
  if (protocol !== "openai-compatible" || !sdkTarget || sdkTarget === "native-fetch") {
    throw new Error("AI SDK transport is not configured for this provider.");
  }

  const model = createSdkLanguageModel(input, sdkTarget);
  const messages = input.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  if (input.stream ?? true) {
    const result = streamText({
      model,
      messages,
      abortSignal: input.signal,
    });

    let text = "";
    input.onEvent?.({ event: "sdk-start", data: input.model });

    for await (const chunk of result.textStream) {
      text += chunk;
      input.onChunk?.(chunk);
      input.onEvent?.({ event: "sdk-chunk", data: chunk });
    }

    input.onEvent?.({ event: "sdk-finish", data: input.model });

    return {
      text,
      usage: mapSdkUsage(await Promise.resolve(result.usage as unknown).catch(() => undefined)),
    };
  }

  const result = await generateText({
    model,
    messages,
    abortSignal: input.signal,
  });

  return {
    text: result.text,
    usage: mapSdkUsage(result.usage),
  };
}

function createSdkLanguageModel(
  input: LLMRequest,
  sdkTarget: "openai" | "openai-compatible"
) {
  const baseURL = normalizeBaseUrl(input.apiBaseUrl || DEFAULT_API_BASE_URL);

  if (sdkTarget === "openai") {
    const openai = createOpenAI({
      apiKey: input.apiKey,
      baseURL,
    });
    return openai.chat(input.model);
  }

  const provider = createOpenAICompatible({
    name: input.providerId || "custom-openai-compatible",
    apiKey: input.apiKey,
    baseURL,
  });

  return provider.chatModel(input.model);
}

function mapSdkUsage(
  usage:
    | {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      }
    | undefined
): LLMUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

async function sendToOpenAICompatible(input: LLMRequest): Promise<LLMResponse> {
  const shouldStream = input.stream ?? true;
  const response = await fetch(resolveRequestUrl(input.apiBaseUrl, "openai-compatible"), {
    method: "POST",
    headers: buildOpenAIHeaders(input.apiKey),
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      temperature: 0.4,
      stream: shouldStream,
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(`LLM API error (${response.status}): ${detail || response.statusText}`);
  }

  if (!response.body) {
    throw new Error("LLM response body is missing.");
  }

  if (shouldStream) {
    return parseSSEStream(response, "openai-compatible", input.onChunk, input.onEvent);
  }

  const json = (await response.json()) as JsonRecord;
  return {
    text: extractTextChunk(json, "openai-compatible"),
    usage: extractUsage(json, "openai-compatible"),
  };
}

async function sendToAnthropic(input: LLMRequest): Promise<LLMResponse> {
  const shouldStream = input.stream ?? true;
  const { system, messages } = splitSystemMessages(input.messages);
  const response = await fetch(resolveRequestUrl(input.apiBaseUrl, "anthropic"), {
    method: "POST",
    headers: buildAnthropicHeaders(input.apiKey),
    body: JSON.stringify({
      model: input.model,
      system,
      messages: messages.map((message) => ({
        role: message.role,
        content: [{ type: "text", text: message.content }],
      })),
      max_tokens: 4096,
      temperature: 0.4,
      stream: shouldStream,
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(`Anthropic API error (${response.status}): ${detail || response.statusText}`);
  }

  if (!response.body) {
    throw new Error("Anthropic response body is missing.");
  }

  if (shouldStream) {
    return parseSSEStream(response, "anthropic", input.onChunk, input.onEvent);
  }

  const json = (await response.json()) as JsonRecord;
  return {
    text: extractTextChunk(json, "anthropic"),
    usage: extractUsage(json, "anthropic"),
  };
}

async function sendToGemini(input: LLMRequest): Promise<LLMResponse> {
  const shouldStream = input.stream ?? true;
  const { system, messages } = splitSystemMessages(input.messages);
  const apiKey = input.apiKey?.trim();
  if (!apiKey) {
    throw new Error("Gemini API key is missing.");
  }

  const response = await fetch(resolveGeminiUrl(input.apiBaseUrl, input.model, apiKey, shouldStream), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: system
        ? {
            parts: [{ text: system }],
          }
        : undefined,
      contents: messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        temperature: 0.4,
      },
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(`Gemini API error (${response.status}): ${detail || response.statusText}`);
  }

  if (!response.body) {
    throw new Error("Gemini response body is missing.");
  }

  if (shouldStream) {
    return parseSSEStream(response, "google-gemini", input.onChunk, input.onEvent);
  }

  const json = (await response.json()) as JsonRecord;
  return {
    text: extractTextChunk(json, "google-gemini"),
    usage: extractUsage(json, "google-gemini"),
  };
}

async function sendToChatGptOAuth(input: LLMRequest): Promise<LLMResponse> {
  const response = await fetch(`${CHATGPT_API_BASE_URL}/responses`, {
    method: "POST",
    headers: buildChatGptHeaders(input.accessToken, input.accountId),
    body: JSON.stringify(buildChatGptRequestBody(input)),
    signal: input.signal,
  });

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(`ChatGPT API error (${response.status}): ${detail || response.statusText}`);
  }

  if (!response.body) {
    throw new Error("ChatGPT response body is missing.");
  }

  if (input.stream ?? true) {
    return parseSSEStream(response, "chatgpt-responses", input.onChunk, input.onEvent);
  }

  return parseSSEStream(response, "chatgpt-responses");
}

function buildChatGptRequestBody(input: LLMRequest) {
  const transformedMessages = input.messages.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: [
      {
        type: message.role === "assistant" ? "output_text" : "input_text",
        text: message.content,
      },
    ],
  }));

  const firstMessage = input.messages[0];
  const hasSystemPrompt = firstMessage?.role === "system";

  return {
    model: input.model,
    instructions: hasSystemPrompt ? firstMessage.content : "You are a helpful assistant.",
    input: hasSystemPrompt ? transformedMessages.slice(1) : transformedMessages,
    store: false,
    stream: true,
  };
}

function resolveRequestUrl(baseUrl: string, protocol: Exclude<ProviderProtocol, "google-gemini" | "chatgpt-responses">) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl || DEFAULT_API_BASE_URL);
  if (protocol === "anthropic") {
    return `${normalizedBaseUrl}/messages`;
  }
  return `${normalizedBaseUrl}/chat/completions`;
}

function resolveGeminiUrl(baseUrl: string, model: string, apiKey: string, stream: boolean): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const operation = stream ? "streamGenerateContent?alt=sse" : "generateContent";
  return `${normalizedBaseUrl}/models/${model}:${operation}&key=${apiKey}`.replace(":generateContent&", ":generateContent?");
}

function buildOpenAIHeaders(apiKey?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function buildAnthropicHeaders(apiKey?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };

  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  return headers;
}

function buildChatGptHeaders(accessToken?: string, accountId?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    originator: "opengem",
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }

  return headers;
}

function splitSystemMessages(messages: LLMMessage[]) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");

  return {
    system,
    messages: messages.filter((message) => message.role !== "system"),
  };
}

async function parseSSEStream(
  response: Response,
  protocol: ProviderProtocol,
  onChunk?: (chunk: string) => void,
  onEvent?: (event: LLMStreamEvent) => void
): Promise<LLMResponse> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { text: "" };
  }

  const decoder = new TextDecoder();
  let usage: LLMUsage | undefined;
  let text = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parsed = extractCompleteSSEEvents(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      onEvent?.(event);

      if (event.data === "[DONE]") {
        continue;
      }

      const json = safeJsonParse<JsonRecord>(event.data);
      if (!json) {
        if (event.event === "chunk" || event.event === "message") {
          const merged = mergeStreamText(text, event.data);
          text = merged.text;
          if (merged.delta) {
            onChunk?.(merged.delta);
          }
        }
        continue;
      }

      if (!usage) {
        usage = extractUsage(json, protocol);
      }

      const chunk = extractTextChunk(json, protocol);
      if (!chunk) {
        continue;
      }

      const merged = mergeStreamText(text, chunk);
      text = merged.text;
      if (merged.delta) {
        onChunk?.(merged.delta);
      }
    }
  }

  if (buffer.trim().length > 0) {
    const fallback = parseSSEEventBlock(buffer);
    if (fallback) {
      onEvent?.(fallback);
      const json = safeJsonParse<JsonRecord>(fallback.data);
      if (json) {
        if (!usage) {
          usage = extractUsage(json, protocol);
        }
        const chunk = extractTextChunk(json, protocol);
        if (chunk) {
          const merged = mergeStreamText(text, chunk);
          text = merged.text;
          if (merged.delta) {
            onChunk?.(merged.delta);
          }
        }
      }
    }
  }

  return { text, usage };
}

function mergeStreamText(currentText: string, nextChunk: string): {
  text: string;
  delta: string;
} {
  if (!nextChunk) {
    return { text: currentText, delta: "" };
  }

  if (!currentText) {
    return { text: nextChunk, delta: nextChunk };
  }

  if (nextChunk === currentText) {
    return { text: currentText, delta: "" };
  }

  if (nextChunk.startsWith(currentText)) {
    return {
      text: nextChunk,
      delta: nextChunk.slice(currentText.length),
    };
  }

  if (currentText.endsWith(nextChunk)) {
    return { text: currentText, delta: "" };
  }

  return {
    text: `${currentText}${nextChunk}`,
    delta: nextChunk,
  };
}

function extractCompleteSSEEvents(buffer: string): {
  events: LLMStreamEvent[];
  remainder: string;
} {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events = blocks.map(parseSSEEventBlock).filter((event): event is LLMStreamEvent => Boolean(event));
  return { events, remainder };
}

function parseSSEEventBlock(block: string): LLMStreamEvent | null {
  const lines = block.split("\n");
  let eventName = "message";
  let eventId: string | undefined;
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim() || "message";
      continue;
    }

    if (line.startsWith("id:")) {
      eventId = line.slice(3).trim() || undefined;
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event: eventName,
    data: dataLines.join("\n"),
    id: eventId,
  };
}

function extractTextChunk(payload: JsonRecord, protocol: ProviderProtocol): string {
  if (protocol === "anthropic") {
    const delta = readPath(payload, ["delta", "text"]);
    if (typeof delta === "string") {
      return delta;
    }

    const anthropicContent = readPath(payload, ["content"]);
    if (Array.isArray(anthropicContent)) {
      return anthropicContent
        .map((item) => (item && typeof item === "object" ? (item as JsonRecord).text : ""))
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join("");
    }
  }

  if (protocol === "google-gemini") {
    const parts = readPath(payload, ["candidates", 0, "content", "parts"]);
    if (Array.isArray(parts)) {
      return parts
        .map((part) => (part && typeof part === "object" ? (part as JsonRecord).text : ""))
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join("");
    }
  }

  const openAIChunk = readPath(payload, ["choices", 0, "delta", "content"]);
  if (typeof openAIChunk === "string" && openAIChunk.length > 0) {
    return openAIChunk;
  }

  const openAIMessage = readPath(payload, ["choices", 0, "message", "content"]);
  if (typeof openAIMessage === "string" && openAIMessage.length > 0) {
    return openAIMessage;
  }

  const directDelta = payload.delta;
  if (typeof directDelta === "string" && directDelta.length > 0) {
    return directDelta;
  }

  const directText = payload.text;
  if (typeof directText === "string" && directText.length > 0) {
    return directText;
  }

  const outputText = payload.output_text;
  if (typeof outputText === "string" && outputText.length > 0) {
    return outputText;
  }

  const nestedOutputText = readPath(payload, ["response", "output_text"]);
  if (typeof nestedOutputText === "string" && nestedOutputText.length > 0) {
    return nestedOutputText;
  }

  return "";
}

function extractUsage(payload: JsonRecord, protocol: ProviderProtocol): LLMUsage | undefined {
  if (protocol === "google-gemini") {
    const usage = payload.usageMetadata as GoogleUsage | undefined;
    if (!usage) return undefined;
    return {
      promptTokens: usage.promptTokenCount,
      completionTokens: usage.candidatesTokenCount,
      totalTokens: usage.totalTokenCount,
    };
  }

  const usage = payload.usage as OpenAIUsage | JsonRecord | undefined;
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  if ("input_tokens" in usage || "output_tokens" in usage || "total_tokens" in usage) {
    return {
      promptTokens: readNumber(usage, "input_tokens"),
      completionTokens: readNumber(usage, "output_tokens"),
      totalTokens: readNumber(usage, "total_tokens"),
    };
  }

  return {
    promptTokens: readNumber(usage, "prompt_tokens"),
    completionTokens: readNumber(usage, "completion_tokens"),
    totalTokens: readNumber(usage, "total_tokens"),
  };
}

function readNumber(value: JsonRecord, key: string): number | undefined {
  const result = value[key];
  return typeof result === "number" ? result : undefined;
}

function readPath(value: unknown, path: Array<string | number>): unknown {
  let current = value;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[key];
      continue;
    }

    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = (current as JsonRecord)[key];
  }
  return current;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function safeJsonParse<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
