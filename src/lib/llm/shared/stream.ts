import type { ProviderProtocol } from "@/data/llmCatalog";

import type { JsonRecord, LLMResponse, LLMStreamEvent, LLMUsage } from "../types";
import { safeJsonParse } from "./json";
import { extractTextChunk, extractUsage } from "./payload";

export async function parseSSEStream(
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
