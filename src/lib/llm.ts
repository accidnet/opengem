export type LLMRole = "user" | "assistant" | "system"

export type LLMMessage = {
  role: LLMRole
  content: string
}

export type LLMUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export type LLMRequest = {
  apiBaseUrl: string
  apiKey?: string
  model: string
  messages: LLMMessage[]
  stream?: boolean
  signal?: AbortSignal
  onChunk?: (chunk: string) => void
}

export type LLMResponse = {
  text: string
  usage?: LLMUsage
}

const DEFAULT_API_BASE_URL = "https://api.openai.com/v1"

type OpenAIChoice = {
  finish_reason?: string
  delta?: {
    content?: string
  }
  message?: {
    role?: string
    content?: string
  }
}

type OpenAIUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

type OpenAIResponse = {
  choices?: OpenAIChoice[]
  usage?: OpenAIUsage
}

export async function sendToLLM(input: LLMRequest): Promise<LLMResponse> {
  const baseUrl = normalizeBaseUrl(input.apiBaseUrl || DEFAULT_API_BASE_URL)
  const shouldStream = input.stream ?? true
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: buildHeaders(input.apiKey),
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      temperature: 0.4,
      stream: shouldStream,
    }),
    signal: input.signal,
  })

  if (!response.ok) {
    const detail = await safeReadText(response)
    throw new Error(`LLM API 오류 (${response.status}): ${detail || response.statusText}`)
  }

  if (!response.body) {
    throw new Error("LLM 응답 본문을 읽을 수 없습니다.")
  }

  if (shouldStream) {
    return parseOpenAIStream(response, input.onChunk)
  }

  const json = (await response.json()) as OpenAIResponse
  const message = (json.choices?.[0]?.message?.content || "") as string
  const usage = toUsage(json.usage)
  return { text: message, usage }
}

function buildHeaders(apiKey?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

async function parseOpenAIStream(response: Response, onChunk?: (chunk: string) => void): Promise<LLMResponse> {
  const reader = response.body?.getReader()
  if (!reader) {
    return { text: "" }
  }

  const decoder = new TextDecoder()
  let usage: LLMUsage | undefined
  let text = ""
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split("\n\n")
    buffer = events.pop() ?? ""

    for (const evt of events) {
      const dataLine = evt
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("data:"))

      if (!dataLine) {
        continue
      }

      const raw = dataLine.slice(5).trim()
      if (raw === "[DONE]") {
        continue
      }

      const parsed = safeJsonParse<OpenAIResponse>(raw)
      if (!parsed) {
        continue
      }

      if (!usage && parsed.usage) {
        usage = toUsage(parsed.usage)
      }

      const chunk = parsed.choices?.[0]?.delta?.content
      if (!chunk) {
        continue
      }

      text += chunk
      onChunk?.(chunk)
    }
  }

  return { text, usage }
}

function toUsage(raw?: OpenAIUsage): LLMUsage | undefined {
  if (!raw) {
    return undefined
  }
  return {
    promptTokens: raw.prompt_tokens,
    completionTokens: raw.completion_tokens,
    totalTokens: raw.total_tokens,
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ""
  }
}

function safeJsonParse<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}
