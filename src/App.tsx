import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const CHAT_MODEL = "gpt-4o-mini";
const STORAGE_KEY = "opengem:chat-session-v1";
const THEME_KEY = "opengem:theme";
const VIEW_MODE_KEY = "opengem:view-mode";
const API_KEY_KEY = "opengem:api-key";
const AGENTS_KEY = "opengem:agent-list";
const SYSTEM_PROMPT = "너는 친절하고 간결한 한국어 챗봇 어시스턴트야.";
const DEFAULT_THEME = "light";
const DEFAULT_VIEW_MODE = "studio";

type Theme = "light" | "dark";
type ViewMode = "studio" | "messenger";

interface Agent {
  id: string;
  name: string;
  emoji: string;
  emojiClass?: string;
  model: string;
  prompt: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  ts: string;
}

interface ActivityLog {
  type: string;
  text: string;
  ts: string;
}

interface StoredSession {
  messages?: unknown[];
}

const DEFAULT_AGENTS: Agent[] = [
  {
    id: "admin",
    name: "관리자",
    emoji: "👤",
    emojiClass: "agent-emoji-admin",
    model: CHAT_MODEL,
    prompt: SYSTEM_PROMPT,
  },
  {
    id: "frontend",
    name: "프론트개발자",
    emoji: "👨🏽‍💻",
    emojiClass: "agent-emoji-frontend",
    model: CHAT_MODEL,
    prompt: SYSTEM_PROMPT,
  },
  {
    id: "backend",
    name: "백엔드개발자",
    emoji: "👩🏾‍💻",
    emojiClass: "agent-emoji-backend",
    model: CHAT_MODEL,
    prompt: SYSTEM_PROMPT,
  },
];

function ensureAgentDefaults(agents: unknown[]): Agent[] {
  const list = Array.isArray(agents) ? agents : [];
  const mapped = list
    .map((item): Agent | null => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.trim() : "";
      const model = typeof o.model === "string" ? o.model.trim() : CHAT_MODEL;
      const prompt = typeof o.prompt === "string" ? o.prompt.trim() : SYSTEM_PROMPT;
      if (!name) return null;
      return {
        id: typeof o.id === "string" && o.id.trim() ? o.id.trim() : `agent-${Date.now()}`,
        name,
        emoji: typeof o.emoji === "string" && o.emoji.trim() ? o.emoji.trim() : "👤",
        emojiClass:
          typeof o.emojiClass === "string" && o.emojiClass.trim() ? o.emojiClass.trim() : "",
        model: model || CHAT_MODEL,
        prompt,
      };
    })
    .filter((x): x is Agent => x !== null);

  if (mapped.length === 0) {
    return DEFAULT_AGENTS.map((item) => ({
      ...item,
      model: CHAT_MODEL,
      prompt: SYSTEM_PROMPT,
    }));
  }

  return mapped;
}

function loadAgents(): Agent[] {
  try {
    const raw = localStorage.getItem(AGENTS_KEY);
    if (!raw) {
      return DEFAULT_AGENTS.map((item) => ({
        ...item,
        model: CHAT_MODEL,
        prompt: SYSTEM_PROMPT,
      }));
    }
    const parsed = JSON.parse(raw) as { agents?: unknown[] };
    const parsedAgents = parsed && typeof parsed === "object" ? (parsed.agents ?? []) : [];
    return ensureAgentDefaults(Array.isArray(parsedAgents) ? parsedAgents : []);
  } catch {
    return DEFAULT_AGENTS.map((item) => ({
      ...item,
      model: CHAT_MODEL,
      prompt: SYSTEM_PROMPT,
    }));
  }
}

function createNewAgentId(): string {
  return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function loadStorage(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession | null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch {
    return null;
  }
}

function normalizeMessage(item: unknown): Message | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  if (o.role !== "user" && o.role !== "assistant") return null;
  const content = typeof o.content === "string" ? o.content.trim() : "";
  if (!content) return null;
  return {
    role: o.role as "user" | "assistant",
    content,
    ts: (typeof o.ts === "string" ? o.ts : formatTime()) as string,
  };
}

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function loadViewMode(): ViewMode {
  try {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    if (saved === "messenger" || saved === "studio") return saved;
    return DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

function loadApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_KEY) || "";
  } catch {
    return "";
  }
}

export default function App() {
  const persisted = loadStorage();

  const [apiKey, setApiKey] = useState<string>(loadApiKey);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>(() => {
    const normalized = (persisted?.messages ?? [])
      .map(normalizeMessage)
      .filter((x): x is Message => x !== null);
    return normalized;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const [agentOptions, setAgentOptions] = useState<Agent[]>(loadAgents);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsApiKey, setSettingsApiKey] = useState("");
  const [isAddAgentOpen, setIsAddAgentOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentModel, setNewAgentModel] = useState(CHAT_MODEL);
  const [newAgentPrompt, setNewAgentPrompt] = useState("");
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(() => [
    { type: "system", text: "워크스페이스가 준비되었습니다.", ts: formatTime() },
  ]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        messages,
      })
    );
  }, [messages]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem(API_KEY_KEY, apiKey);
    } catch {
      // ignore
    }
  }, [apiKey]);

  useEffect(() => {
    try {
      localStorage.setItem(AGENTS_KEY, JSON.stringify({ agents: agentOptions }));
    } catch {
      // ignore
    }
  }, [agentOptions]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    setSettingsApiKey(apiKey);
  }, [isSettingsOpen, apiKey]);

  useEffect(() => {
    if (!selectedAgent && agentOptions.length > 0) {
      setSelectedAgent(agentOptions[0]);
    }
  }, [agentOptions, selectedAgent]);

  const canSend = apiKey.trim().length > 0 && message.trim().length > 0 && !loading;

  const pushActivity = (type: string, text: string) => {
    setActivityLogs((prev) => [...prev, { type, text, ts: formatTime() }]);
  };

  const appendMessage = (role: "user" | "assistant", content: string) => {
    setMessages((prev) => [...prev, { role, content, ts: formatTime() }]);
  };

  const toggleTheme = () => {
    setTheme((value) => (value === "dark" ? "light" : "dark"));
  };

  const toggleViewMode = () => {
    const nextMode: ViewMode = viewMode === "studio" ? "messenger" : "studio";
    setViewMode(nextMode);
    pushActivity(
      "system",
      `모드를 ${nextMode === "studio" ? "스튜디오" : "메신저"}로 변경했습니다.`
    );
  };

  const openSettings = () => {
    setIsSettingsOpen(true);
  };

  const closeSettings = () => {
    setIsSettingsOpen(false);
  };

  const saveSettings = () => {
    const trimmed = settingsApiKey.trim();
    setApiKey(trimmed);
    setIsSettingsOpen(false);
    if (trimmed) {
      pushActivity("system", "설정에서 API 키를 업데이트했습니다.");
    } else {
      pushActivity("system", "설정에서 API 키를 제거했습니다.");
    }
  };

  const openAddAgent = () => {
    setNewAgentName("");
    setNewAgentModel(CHAT_MODEL);
    setNewAgentPrompt("");
    setError("");
    setIsAddAgentOpen(true);
  };

  const closeAddAgent = () => {
    setError("");
    setIsAddAgentOpen(false);
  };

  const saveAddAgent = () => {
    const trimmedName = newAgentName.trim();
    const trimmedModel = newAgentModel.trim() || CHAT_MODEL;
    const trimmedPrompt = newAgentPrompt.trim() || SYSTEM_PROMPT;

    if (!trimmedName) {
      setError("에이전트 이름을 입력해 주세요.");
      return;
    }

    const nextAgent: Agent = {
      id: createNewAgentId(),
      name: trimmedName,
      emoji: "👤",
      model: trimmedModel,
      prompt: trimmedPrompt,
    };

    setAgentOptions((prev) => [...prev, nextAgent]);
    setSelectedAgent(nextAgent);
    setIsAddAgentOpen(false);
    setError("");
    pushActivity("system", `${trimmedName} 에이전트를 추가했습니다.`);
  };

  const sendMessage = async () => {
    const text = message.trim();
    if (!text || loading) return;

    if (!apiKey.trim()) {
      setError("설정에서 OpenAI API 키를 먼저 입력하세요.");
      setErrorCode("MISSING_API_KEY");
      pushActivity("error", "API 키가 없어 요청을 보낼 수 없습니다.");
      return;
    }

    if (!apiKey.startsWith("sk-")) {
      setError("유효하지 않은 형식의 API 키일 수 있습니다.");
      setErrorCode("INVALID_API_KEY");
      pushActivity("error", "API 키 형식이 올바르지 않습니다.");
      return;
    }

    const outgoing: Message = {
      role: "user",
      content: text,
      ts: formatTime(),
    };
    setMessages((prev) => [...prev, outgoing]);
    setMessage("");
    setLoading(true);
    setError("");
    setErrorCode("");
    pushActivity("request", "모델로 메시지를 전송했습니다.");

    try {
      const chatHistory = [
        { role: "system", content: selectedAgent?.prompt || SYSTEM_PROMPT },
        ...messages.map(({ role, content }) => ({ role, content })),
        outgoing,
      ];

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: selectedAgent?.model || CHAT_MODEL,
          messages: chatHistory,
          temperature: 0.6,
        }),
      });

      if (!response.ok) {
        const nextCode = response.status === 401 ? "UNAUTHORIZED" : `HTTP_${response.status}`;
        const err = new Error(`요청 실패: ${response.status} ${response.statusText}`) as Error & {
          code?: string;
        };
        err.code = nextCode;
        throw err;
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: { content?: string };
        }>;
      };
      const answer =
        data?.choices?.[0]?.message?.content ??
        "응답 형식이 맞지 않습니다. 잠시 후 다시 시도해 주세요.";
      appendMessage("assistant", answer);
      pushActivity("success", "에이전트 응답을 받았습니다.");
    } catch (e) {
      const err = e as Error & { code?: string };
      const errCode = err?.code ?? "NETWORK";
      const msg = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
      setErrorCode(typeof errCode === "string" && errCode ? errCode : "NETWORK");
      setError(msg);
      appendMessage("assistant", "요청 실패. API 키, 네트워크, 또는 권한 이슈를 확인해 주세요.");
      pushActivity("error", `요청 실패: ${typeof errCode === "string" ? errCode : "NETWORK"}`);
    } finally {
      setLoading(false);
    }
  };

  const panelHead = "shrink-0 pb-[0.55rem] border-b border-[var(--stroke)]";
  const panelTitle = "m-0 text-[var(--text-strong)] text-[0.82rem] tracking-[0.08em] uppercase";
  const panelBase =
    "min-h-0 bg-[var(--panel)] border border-[var(--stroke)] rounded-[14px] p-[0.85rem] flex flex-col backdrop-blur-[12px]";

  return (
    <main
      className={`h-full w-[min(1680px,100%)] mx-auto p-[0.8rem] flex flex-col gap-[0.65rem] max-[640px]:p-[0.55rem]`}
    >
      <header className="min-h-[2.1rem] flex justify-end items-center gap-2">
        <Button variant="ghost" size="sm" onClick={toggleViewMode}>
          {viewMode === "studio" ? "Studio" : "Messenger"}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label={theme === "light" ? "다크 모드로" : "라이트 모드로"}
        >
          {theme === "light" ? "🌙" : "☀️"}
        </Button>
      </header>

      <section
        className={`flex-1 min-h-0 grid gap-0 max-xl:grid-cols-[230px_minmax(0,1fr)_260px] max-[980px]:grid-cols-1 max-[980px]:min-h-0 ${
          viewMode === "studio"
            ? "grid-cols-[280px_minmax(0,1fr)_320px]"
            : "grid-cols-[260px_minmax(0,1fr)_300px]"
        }`}
      >
        <aside className={`${panelBase} mr-3 max-[980px]:mr-0 max-[980px]:min-h-[38vh]`}>
          <div className={panelHead}>
            <p className={panelTitle}>Session</p>
          </div>

          <ul className="list-none m-0 p-0 flex-1 min-h-0 overflow-auto grid gap-2 mt-[0.7rem]">
            <li className="border border-[var(--stroke)] rounded-[10px] p-[0.62rem] bg-[var(--panel-soft)]">
              <p className="m-0 text-[var(--text-strong)] font-bold text-[0.9rem]">새 세션</p>
              <p className="mt-0.5 text-[var(--text-soft)] text-[0.82rem]">새 대화를 시작하세요</p>
              <p className="mt-[0.34rem] text-[var(--text-subtle)] text-[0.75rem]">초안</p>
            </li>
          </ul>

          <Button variant="outline" className="mt-[0.55rem]" onClick={openSettings}>
            설정
          </Button>
        </aside>

        <section
          className={`${panelBase} border-r-0 rounded-tr-none rounded-br-none gap-3 max-[980px]:border-r max-[980px]:border-[var(--stroke)] max-[980px]:min-h-[38vh]`}
        >
          {errorCode && (
            <p className="m-0 text-[var(--error)] text-[0.86rem]">마지막 오류: {errorCode}</p>
          )}

          <ul className="list-none m-0 p-0 flex-1 min-h-0 overflow-auto grid gap-[0.65rem] pr-0.5">
            {messages.map((item, idx) => (
              <li
                key={`${item.ts}-${idx}`}
                className="border border-[var(--stroke)] rounded-[10px] p-[0.68rem_0.78rem] bg-[var(--panel-soft)]"
              >
                <span className="inline-flex text-[var(--text-subtle)] text-[0.74rem] mb-[0.22rem]">
                  {item.role === "user" ? "사용자" : "에이전트"}
                </span>
                <p className="m-0 text-[var(--text-main)] whitespace-pre-wrap leading-relaxed">
                  {item.content}
                </p>
                <small className="inline-block mt-[0.33rem] text-[var(--text-subtle)]">
                  {item.ts}
                </small>
              </li>
            ))}
            {loading && (
              <li className="border border-[var(--stroke)] rounded-[10px] p-[0.68rem_0.78rem] bg-[var(--panel-soft)]">
                <span className="inline-flex text-[var(--text-subtle)] text-[0.74rem] mb-[0.22rem]">
                  에이전트
                </span>
                <p className="m-0 text-[var(--text-main)] whitespace-pre-wrap leading-relaxed">
                  응답 생성 중...
                </p>
                <small className="inline-block mt-[0.33rem] text-[var(--text-subtle)]">
                  {formatTime()}
                </small>
              </li>
            )}
          </ul>

          <form
            className="mt-0 grid grid-cols-[1fr_auto] [grid-template-areas:'input_send'_'bottom_send'] gap-[0.55rem] max-[640px]:grid-cols-1 max-[640px]:[grid-template-areas:'input'_'bottom'_'send']"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
          >
            <Textarea
              className="[grid-area:input] min-h-[80px] resize-none"
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="메시지를 입력하세요"
              disabled={loading}
            />
            <div className="[grid-area:bottom] w-full min-w-0">
              <div
                className="grid gap-[0.45rem] max-[640px]:grid-cols-2 max-[640px]:gap-[0.35rem] grid-cols-[repeat(4,4.2rem)]"
                role="list"
                aria-label="에이전트 선택"
              >
                {agentOptions.map((item) => (
                  <button
                    key={item.id}
                    className={`relative grid justify-items-center content-center gap-[0.18rem] p-2 w-[4.2rem] h-[4.2rem] overflow-hidden cursor-pointer rounded-lg text-ellipsis border bg-[var(--chip-bg)] before:content-[''] before:absolute before:top-[0.34rem] before:left-[0.34rem] before:w-[0.46rem] before:h-[0.46rem] before:rounded-full before:bg-red-500 before:shadow-[0_0_0_1px_var(--panel)] hover:bg-[var(--chip-hover)] focus-visible:bg-[var(--chip-hover)] ${
                      selectedAgent?.id === item.id
                        ? "border-[color-mix(in_oklab,var(--accent-cyan),transparent_50%)] bg-[color-mix(in_oklab,var(--chip-hover),var(--panel)_60%)] before:bg-green-500"
                        : "border-[color-mix(in_oklab,var(--stroke),transparent_90%)]"
                    }`}
                    type="button"
                    onClick={() => {
                      setSelectedAgent(item);
                      pushActivity("system", `${item.name}로 전환했습니다.`);
                    }}
                    aria-label={`${item.name}로 변경`}
                  >
                    <span
                      className={`text-base leading-none ${item.emojiClass === "agent-emoji-admin" ? "text-gray-600" : item.emojiClass === "agent-emoji-frontend" ? "text-blue-600" : item.emojiClass === "agent-emoji-backend" ? "text-green-600" : ""}`.trim()}
                      aria-hidden="true"
                    >
                      {item.emoji}
                    </span>
                    <span
                      className={`text-[0.64rem] leading-[1.05] break-words text-center text-[var(--text-main)] max-w-full overflow-hidden ${
                        item.id === "frontend" || item.id === "backend"
                          ? "whitespace-nowrap text-ellipsis"
                          : ""
                      }`}
                    >
                      {item.name}
                    </span>
                  </button>
                ))}
                <button
                  className="relative grid justify-items-center content-center gap-[0.18rem] p-2 w-[4.2rem] h-[4.2rem] overflow-hidden cursor-pointer rounded-lg border border-dashed border-[color-mix(in_oklab,var(--stroke),transparent_80%)] bg-[var(--chip-bg)] before:hidden hover:bg-[var(--chip-hover)] focus-visible:bg-[var(--chip-hover)]"
                  type="button"
                  aria-label="에이전트 추가"
                  onClick={openAddAgent}
                >
                  <span className="text-base leading-none" aria-hidden="true">
                    +
                  </span>
                  <span className="text-[0.64rem] leading-[1.05] break-words text-center text-[var(--text-main)] max-w-full overflow-hidden">
                    추가
                  </span>
                </button>
              </div>
            </div>
            <Button
              className="[grid-area:send] max-[640px]:[grid-area:send]"
              type="submit"
              disabled={!canSend}
            >
              전송
            </Button>
          </form>
          {error && <p className="m-0 text-[var(--error)] text-[0.86rem]">{error}</p>}
        </section>

        <aside className={`${panelBase} rounded-tl-none rounded-bl-none max-[980px]:min-h-[38vh]`}>
          <div className={panelHead}>
            <p className={panelTitle}>Logs</p>
          </div>

          <ul className="list-none m-0 p-0 flex-1 min-h-0 overflow-auto mt-[0.7rem] grid gap-[0.45rem] pr-0.5">
            {[...activityLogs].reverse().map((item, idx) => (
              <li
                key={`${item.ts}-${idx}`}
                className={`border rounded-[10px] bg-[var(--panel-soft)] px-[0.6rem] py-[0.52rem] ${
                  item.type === "error"
                    ? "border-[color-mix(in_oklab,var(--error),transparent_55%)]"
                    : item.type === "success"
                      ? "border-[color-mix(in_oklab,var(--accent-green),transparent_52%)]"
                      : "border-[var(--stroke)]"
                }`}
              >
                <p className="m-0 text-[0.82rem] text-[var(--text-main)]">{item.text}</p>
                <small className="inline-block mt-0.5 text-[var(--text-subtle)]">{item.ts}</small>
              </li>
            ))}
          </ul>
        </aside>
      </section>

      <Dialog open={isSettingsOpen} onOpenChange={(open) => !open && closeSettings()}>
        <DialogContent className="sm:max-w-[440px]" showCloseButton>
          <DialogHeader>
            <DialogTitle>설정</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <div className="grid gap-2">
              <Label htmlFor="settings-api-key">OpenAI API 키</Label>
              <Input
                id="settings-api-key"
                type="password"
                value={settingsApiKey}
                onChange={(e) => setSettingsApiKey(e.target.value)}
                placeholder="sk-..."
              />
            </div>
            <p className="m-0 text-sm text-muted-foreground">API 키는 로컬 저장소에 저장됩니다.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={closeSettings}>
              취소
            </Button>
            <Button type="button" onClick={saveSettings}>
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddAgentOpen} onOpenChange={(open) => !open && closeAddAgent()}>
        <DialogContent className="sm:max-w-[440px]" showCloseButton>
          <DialogHeader>
            <DialogTitle>에이전트 추가</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="add-agent-name">에이전트 이름</Label>
              <Input
                id="add-agent-name"
                type="text"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                placeholder="예: 기획자"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="add-agent-model">모델 선택</Label>
              <Input
                id="add-agent-model"
                type="text"
                value={newAgentModel}
                onChange={(e) => setNewAgentModel(e.target.value)}
                placeholder="예: gpt-4o-mini"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="add-agent-prompt">프롬프트</Label>
              <Textarea
                id="add-agent-prompt"
                rows={3}
                className="min-h-[5.2rem] resize-y"
                value={newAgentPrompt}
                onChange={(e) => setNewAgentPrompt(e.target.value)}
                placeholder="이 에이전트에게 줄 시스템 프롬프트를 입력하세요"
              />
            </div>
            {error && <p className="m-0 text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={closeAddAgent}>
              취소
            </Button>
            <Button type="button" onClick={saveAddAgent}>
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
