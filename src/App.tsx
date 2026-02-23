import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { sendToLLM, type LLMMessage } from "./lib/llm"

type MessageType = "text" | "plan" | "search" | "typing" | "status";

type MessageSide = "agent" | "user" | "status";

type Message = {
  id: string;
  side: MessageSide;
  type: MessageType;
  sender?: string;
  byline?: string;
  avatarText?: string;
  icon?: string;
  iconColor?: string;
  text?: string;
  statusText?: string;
  planTitle?: string;
  steps?: string[];
  logs?: string[];
};

type ActivityState = "done" | "active" | "working" | "pending";

type ActivityItem = {
  id: string;
  source: string;
  byline?: string;
  text: string;
  state: ActivityState;
  progress?: ActivityState[];
  faded?: boolean;
};

type AgentColor = "indigo" | "emerald" | "amber" | "violet" | "rose";

type AgentItem = {
  name: string;
  icon: string;
  status: string;
  color: AgentColor;
  active?: boolean;
};

type SessionItem = {
  name: string;
  time: string;
  active?: boolean;
};

type ThemeMode = "dark" | "light";

type IconBadgeProps = {
  icon: string;
  text?: string;
  color?: string;
};

const env = import.meta.env;

const LLM_CONFIG = {
  baseUrl: env.VITE_LLM_BASE_URL || "https://api.openai.com/v1",
  model: env.VITE_LLM_MODEL || "gpt-4o-mini",
  apiKey: env.VITE_LLM_API_KEY,
} as const;

const LLM_SYSTEM_PROMPT =
  "당신은 멀티 에이전트 오케스트레이션 환경의 AI 오케스트레이터입니다. 사용자의 요청에 대해 구체적이고 실행 가능한 답변을 한국어로 제공합니다. 답변은 간결한 도입부, 핵심 요약, 권장 액션 순서로 작성합니다.";

function extractLLMMessageText(message: Message): string | undefined {
  if (message.type === "plan") {
    const planParts = [message.planTitle, ...(message.steps ?? [])];
    const planText = planParts.filter(Boolean).join("\n");
    if (planText) {
      return `${message.sender ?? "Assistant"} 계획:\n${planText}`;
    }
  }

  if (message.type === "search") {
    const lines: string[] = [];
    if (message.text) {
      lines.push(message.text);
    }
    if (Array.isArray(message.logs)) {
      lines.push(...message.logs);
    }
    const searchText = lines.filter((line) => line.trim().length > 0).join("\n");
    if (searchText) {
      return `${message.sender ?? "Assistant"} 검색:\n${searchText}`;
    }
  }

  if (message.type === "typing") {
    if (message.text && message.text.trim().length > 0) {
      return message.text;
    }
    return undefined;
  }

  if (message.text && message.text.trim().length > 0) {
    return message.text;
  }

  if (Array.isArray(message.logs)) {
    const logs = message.logs.filter((line) => line.trim().length > 0);
    if (logs.length > 0) {
      return logs.join("\n");
    }
  }

  return undefined;
}

function buildLLMMessages(messages: Message[]): LLMMessage[] {
  const chatMessages = messages
    .filter((message) => message.side !== "status" && message.type !== "status")
    .map((message): LLMMessage | null => {
      const content = extractLLMMessageText(message);
      if (!content) {
        return null;
      }

      return {
        role: message.side === "user" ? "user" : "assistant",
        content,
      };
    })
    .filter((entry): entry is LLMMessage => entry !== null);

  return [{ role: "system", content: LLM_SYSTEM_PROMPT }, ...chatMessages];
}

function appendChunkToMessage(messages: Message[], id: string, text: string): Message[] {
  return messages.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          type: "text",
          text,
        }
      : entry,
  );
}

type MessageCardProps = {
  message: Message;
  onApprovePlan: () => void;
  onModifyPlan: () => void;
};

type ActivityCardProps = {
  item: ActivityItem;
};

const SESSION_MESSAGES: Message[] = [
  {
    id: "seed-1",
    side: "agent",
    sender: "System",
    byline: "10:23 AM",
    icon: "smart_toy",
    iconColor: "#94a3b8",
    type: "text",
    text: "멀티 에이전트 오케스트레이터에 오신 것을 환영합니다. 복잡한 워크플로우를 단계별로 분해하고 에이전트를 조율할 수 있습니다. 무엇을 도와드릴까요?",
  },
  {
    id: "seed-2",
    side: "user",
    sender: "You",
    byline: "10:24 AM",
    avatarText: "JD",
    type: "text",
    text: "2024년 AI 하드웨어 스타트업 상위 3곳에 대한 시장 분석이 필요해. 자금 조달 현황과 핵심 기술 차별화 요소도 포함해줘.",
  },
  {
    id: "seed-3",
    side: "agent",
    sender: "Planner Agent",
    byline: "10:24 AM",
    icon: "account_tree",
    iconColor: "#a5b4fc",
    type: "plan",
    planTitle: "요청을 다음 단계로 분해했습니다.",
    steps: [
      '연구 에이전트가 2024년 AI 하드웨어 스타트업 상위 3곳을 선정하고, 공개 출처에서 자금 조달 데이터를 수집합니다.',
      '각 후보사의 기술 문서 및 백서를 검토한 뒤 핵심 차별화 요소를 정리합니다.',
      '분석 에이전트가 비교 표를 작성하고 주요 인사이트를 추출합니다.',
    ],
  },
  {
    id: "seed-4",
    side: "status",
    type: "status",
    statusText: "사용자가 계획을 승인했습니다",
  },
  {
    id: "seed-5",
    side: "agent",
    sender: "Researcher Agent",
    byline: "10:25 AM",
    icon: "travel_explore",
    iconColor: "#6ee7b7",
    type: "search",
    text: '"AI 하드웨어 스타트업 자금 조달 2024"를 검색 중입니다.',
    logs: [
      '> search_tool 쿼리 실행 중 query="AI hardware startups funding 2024"',
      '> 검색 결과 12건 발견',
      '> 높은 관련성 결과 필터링 중',
      '> 후보 추출 완료: [Cerebras, Groq, SambaNova]',
    ],
  },
  {
    id: "seed-6",
    side: "agent",
    sender: "Researcher Agent",
    byline: "",
    icon: "travel_explore",
    iconColor: "#86efac",
    type: "typing",
    text: "기술 차별화 요소 분석 중...",
  },
];

const INITIAL_ACTIVITY: ActivityItem[] = [
  {
    id: "act-1",
    source: "Orchestrator",
    byline: "10:24:05",
    text: 'Workflow "Market Analysis" started with 2 agents assigned.',
    state: "done",
  },
  {
    id: "act-2",
    source: "Planner",
    byline: "10:24:12",
    text: "Execution plan created.",
    state: "active",
    progress: ["done", "pending", "pending"],
  },
  {
    id: "act-3",
    source: "Researcher",
    byline: "",
    text: "Google Search API\nCollecting URL 1...",
    state: "working",
  },
  {
    id: "act-4",
    source: "Analyst",
    byline: "Queue",
    text: "Waiting for research data...",
    state: "pending",
    faded: true,
  },
];

const MODES = ["Orchestrator", "Dev Mode", "Custom"] as const;
type Mode = (typeof MODES)[number];

const AGENTS: AgentItem[] = [
  { name: "관리자", icon: "account_tree", status: "대기 중", color: "indigo" },
  {
    name: "프론트개발자",
    icon: "travel_explore",
    status: "수집 중...",
    color: "emerald",
    active: true,
  },
  { name: "백엔드개발자", icon: "code", status: "오프라인", color: "amber" },
  { name: "오신엽", icon: "design_services", status: "오프라인", color: "violet" },
  { name: "김상현", icon: "database", status: "오프라인", color: "rose" },
];

const TOOLS: string[] = ["웹 브라우저", "Python Repl", "파일 시스템"];

const SESSIONS: SessionItem[] = [
  { name: "Market Analysis #42", time: "Today, 10:23 AM", active: true },
  { name: "Code Review: Auth Service", time: "Yesterday" },
  { name: "Product Roadmap Q4", time: "Oct 24" },
];

function nowTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildTypingMessage(text: string): Message {
  return {
    id: `typing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    side: "agent",
    sender: "연구 에이전트",
    byline: nowTime(),
    icon: "travel_explore",
    iconColor: "#86efac",
    type: "typing",
    text,
  };
}

function buildReplyMessage(input: string): Message {
  const summary = input.length > 120 ? `${input.slice(0, 120)}...` : input;
  return {
    id: `reply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    side: "agent",
    sender: "기획 에이전트",
    byline: nowTime(),
    icon: "account_tree",
    iconColor: "#a5b4fc",
    type: "text",
    text: `요청을 반영해 실행 계획을 갱신했습니다. 핵심 키워드는 "${summary}"이며, Researcher/Analyst 에이전트를 추가로 할당해 자금 조달 및 기술 차별화 항목을 정리하겠습니다.`,
  };
}

function buildActivity(statusText: string, source: string): ActivityItem {
  return {
    id: `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    source,
    byline: nowTime(),
    text: statusText,
    state: "working",
  };
}

function IconBadge({ icon, text, color }: IconBadgeProps) {
  return (
    <span
      className={`icon-badge ${color ? `icon-badge-${color}` : ""}`}
      aria-hidden="true"
      role="img"
    >
      <span className="material-symbols-outlined" style={{ color: color || "#94a3b8" }}>
        {icon}
      </span>
      {text}
    </span>
  );
}

function MessageCard({ message, onApprovePlan, onModifyPlan }: MessageCardProps) {
  const text = typeof message.text === "string" ? message.text : "";
  const bubbleText = text.trim();

  if (message.type === "status") {
    if (!message.statusText || !String(message.statusText).trim()) {
      return null;
    }

    return (
      <div className="message-status-wrap" key={message.id}>
        <span className="status-pill">{message.statusText}</span>
      </div>
    );
  }

  if (message.side === "user") {
    if (!bubbleText) {
      return null;
    }

    return (
        <div className="message-row user" key={message.id}>
          <div className="message-bubble user-bubble">
            <div className="bubble-meta-right">
              <span className="bubble-time">{message.byline}</span>
              <span className="bubble-name" style={{ color: "#fff" }}>
                {message.sender}
              </span>
            </div>
            <p className="bubble-text">{bubbleText}</p>
          </div>
          <div className="message-avatar avatar-user">{message.avatarText}</div>
        </div>
    );
  }

  const classes = ["message-row", "agent", message.type === "typing" ? "typing" : ""].filter(Boolean);
  const logs = Array.isArray(message.logs) ? message.logs : [];

  return (
    <div className={classes.join(" ")} key={message.id}>
      <div className="message-avatar avatar-agent" style={{ color: message.iconColor || "#94a3b8" }}>
        <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
          {message.icon}
        </span>
      </div>
      <div className="message-bubble">
        <div className="bubble-meta">
          <span className="bubble-name" style={{ color: message.iconColor || "#a5b4fc" }}>
            {message.sender}
          </span>
          {message.byline ? <span className="bubble-time">{message.byline}</span> : null}
        </div>
        {message.type === "plan" ? (
          <>
            <p className="bubble-text plan-text">{message.planTitle}</p>
            <ol className="plan-list">
              {(message.steps ?? []).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
              <div className="message-actions">
                <button type="button" className="pill-btn" onClick={onApprovePlan}>
                  계획 승인
                </button>
                <button type="button" className="pill-btn outline" onClick={onModifyPlan}>
                  수정 요청
                </button>
              </div>
            </>
          ) : null}
        {message.type === "search" ? (
          <>
            {bubbleText ? <p className="bubble-text">{bubbleText}</p> : null}
              <div className="tool-log-box">
                <div className="tool-log-title">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "14px", color: "#94a3b8" }}
                  >
                    terminal
                  </span>
                  <span>tool_execution.log</span>
                </div>
               <div className="tool-log-body">
                 <pre>
                   {logs.map((line) => `${line}\n`).join("")}
                 </pre>
               </div>
            </div>
          </>
        ) : null}
        {message.type === "text" && bubbleText ? <p className="bubble-text">{bubbleText}</p> : null}
        {message.type === "typing" ? (
          <div className="typing-inline">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
            {bubbleText ? <span className="bubble-text">{bubbleText}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActivityCard({ item }: ActivityCardProps) {
  const timelineDotClass: Record<ActivityState, string> = {
    done: "timeline-dot-done",
    active: "timeline-dot-active",
    working: "timeline-dot-working",
    pending: "timeline-dot-pending",
  };

  return (
    <div className={`timeline-item ${item.faded ? "timeline-item-faded" : ""}`}>
      <div className={`timeline-dot ${timelineDotClass[item.state]}`} />
      <div className="timeline-body">
        <div className="timeline-title-wrap">
          <span className="timeline-name">{item.source}</span>
            <span className="timeline-time">{item.byline || "진행 중"}</span>
        </div>
        <p className="timeline-text">{item.text}</p>
        {item.progress ? (
          <div className="progress-wrap">
            {item.progress.map((state, idx) => (
              <span key={idx} className={`progress-seg ${state}`} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>(SESSION_MESSAGES);
  const [activity, setActivity] = useState<ActivityItem[]>(INITIAL_ACTIVITY);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState<Mode>(MODES[0]);
  const [resourceToken, setResourceToken] = useState(2405);
  const [resourceCost, setResourceCost] = useState(0.04);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // 테마 변경 시 document에 data-theme 속성 적용
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const canSend = inputValue.trim().length > 0 && !isLoading;

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    const timer = setInterval(() => {
      setResourceToken((value) => Math.min(9999, value + 9));
      setResourceCost((value) => Number((value + 0.001).toFixed(3)));
    }, 6500);

    return () => clearInterval(timer);
  }, []);

  const tokenPercent = useMemo(() => {
    return Math.max(5, Math.min(90, Math.round((resourceToken / 12000) * 100)));
  }, [resourceToken]);

  const costPercent = useMemo(() => {
    return Math.max(10, Math.min(65, Math.round((resourceCost / 0.35) * 100)));
  }, [resourceCost]);

  const sendMessage = async (): Promise<void> => {
    if (!canSend) return;

    const text = inputValue.trim();
    if (!text) {
      return;
    }

    const userMessage: Message = {
      id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      side: "user",
      sender: "사용자",
      byline: nowTime(),
      avatarText: "JD",
      type: "text",
      text,
    };

    const typingMessage = buildTypingMessage("응답을 생성 중입니다...");

    setMessages((prev) => [...prev, userMessage, typingMessage]);
    setActivity((prev) => [
      ...prev,
      buildActivity(`새 메시지 수신: "${text.slice(0, 32)}"`, "오케스트레이터"),
    ]);
    setInputValue("");
    setIsLoading(true);

    const latestMessages = [...messages, userMessage];
    const requestMessages = buildLLMMessages(latestMessages);

    if (!LLM_CONFIG.apiKey) {
      const fallbackReply = buildReplyMessage(text);
      setMessages((prev) => prev.map((entry) => (entry.id === typingMessage.id ? fallbackReply : entry)));
      setActivity((prev) => [
        ...prev,
        buildActivity("LLM API 키가 없어 샘플 응답으로 대체했습니다.", "기획자"),
      ]);
      setIsLoading(false);
      return;
    }

    setMessages((prev) =>
      prev.map((entry) =>
        entry.id === typingMessage.id
          ? {
              ...entry,
              type: "text",
              text: "",
            }
          : entry,
      ),
    );

    let streamedText = "";

    try {
      const response = await sendToLLM({
        apiBaseUrl: LLM_CONFIG.baseUrl,
        apiKey: LLM_CONFIG.apiKey,
        model: LLM_CONFIG.model,
        messages: requestMessages,
        stream: true,
        onChunk: (chunk) => {
          streamedText += chunk;
          setMessages((prev) => appendChunkToMessage(prev, typingMessage.id, streamedText));
        },
      });

      setMessages((prev) =>
        prev.map((entry) =>
          entry.id === typingMessage.id
            ? {
                ...entry,
                type: "text",
                text: response.text || streamedText || "(빈 응답)",
              }
            : entry,
        ),
      );

      if (typeof response.usage?.totalTokens === "number") {
        const usedTokens = response.usage.totalTokens;
        setResourceToken((prev) => Math.min(9999, prev + usedTokens));
      }

      const estimatedCost = response.usage?.totalTokens ? response.usage.totalTokens * 0.000005 : 0;
      if (estimatedCost > 0) {
        setResourceCost((prev) => Number((prev + estimatedCost).toFixed(3)));
      }

      const usageText = response.usage?.totalTokens
        ? ` 토큰 ${response.usage.totalTokens}개 사용`
        : "";
      setActivity((prev) => [
        ...prev,
        buildActivity(`에이전트 응답 수신 완료${usageText}`.trim(), "기획자"),
      ]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
      setMessages((prev) =>
        prev.map((entry) =>
          entry.id === typingMessage.id
            ? {
                ...entry,
                type: "text",
                text: `요청 처리 실패: ${reason}`,
              }
            : entry,
        ),
      );
      setActivity((prev) => [
        ...prev,
        buildActivity("LLM 응답 수신 중 오류가 발생했습니다.", "시스템"),
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const appendStatusMessage = (text: string): void => {
    setMessages((prev) => [
      ...prev,
      {
        id: `status-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        side: "status",
        type: "status",
        statusText: text,
      },
    ]);
  };

  const handleApprovePlan = () => {
    appendStatusMessage("사용자가 계획을 승인했습니다");
    setActivity((prev) => [
      ...prev,
      buildActivity("사용자가 계획을 승인했습니다. 연구 에이전트가 실행을 시작합니다.", "기획자"),
    ]);
  };

  const handleModifyPlan = () => {
    setInputValue("실행 전에 계획을 구체적으로 수정해줘.");
    appendStatusMessage("사용자가 계획 수정 요청");
    setActivity((prev) => [
      ...prev,
      buildActivity("사용자가 계획 수정을 요청했습니다.", "Planner"),
    ]);
  };

  const clearContext = () => {
    setMessages(SESSION_MESSAGES);
    setInputValue("");
    setActivity([
      ...INITIAL_ACTIVITY,
      buildActivity("세션이 초기화되어 기본 상태로 되돌아갑니다.", "시스템"),
    ]);
  };

  const exportChat = async () => {
    const text = messages
      .map((item) => {
        if (item.side === "status") return `[status] ${item.statusText}`;
        return `${item.sender} ${item.byline || ""}\n${item.text || ""}`;
      })
      .join("\n\n");

    if (!navigator?.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(text);
    setActivity((prev) => [...prev, buildActivity("채팅 기록을 클립보드에 복사했습니다.", "시스템")]);
  };

  const onEnterSubmit = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-left">
          <div className="brand-chip">
            <div className="brand-mark">
              <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
                smart_toy
              </span>
            </div>
            <div className="brand-copy">
              <p className="brand-title">OpenGem</p>
            </div>
          </div>
          <div className="separator" />
          <div className="session-label-wrap">
            <h2>Market Analysis Session #42</h2>
            <span className="running-pill">Running</span>
          </div>
        </div>
        <div className="top-center">
          <button className="nav-link active">Chat</button>
          <button className="nav-link">Dashboard</button>
        </div>
        <div className="top-right">
          <button className="icon-btn" title="Export Chat" onClick={exportChat}>
            <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
              ios_share
            </span>
          </button>
          <button className="icon-btn" title="Clear Context" onClick={clearContext}>
            <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
              delete_sweep
            </span>
          </button>
          {/* 다크/라이트 모드 토글 버튼 */}
          <button
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <span className="profile-dot">JD</span>
        </div>
      </header>

      <main className="body-grid">
        <aside className="left-panel">
          <section className="panel-block">
            <div className="section-head-with-action">
              <h3 className="section-title">Operation Mode</h3>
              <button className="new-session-btn new-session-btn-small" type="button">
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                  add
                </span>
                Session
              </button>
            </div>
            <div className="mode-card">
              <button
                type="button"
                className={`mode-btn ${selectedMode === MODES[0] ? "is-active" : ""}`}
                onClick={() => setSelectedMode(MODES[0])}
              >
                <div className="btn-side">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "20px", color: "#38bdf8" }}
                  >
                    smart_toy
                  </span>
                  <span>Orchestrator</span>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                  expand_more
                </span>
              </button>
              <div className="sub-session-list">
                {SESSIONS.map((session) => (
                  <button
                    key={session.name}
                    type="button"
                    className={`session-row ${session.active ? "session-row-active" : ""}`}
                  >
                    <span>{session.name}</span>
                    <span>{session.time}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mode-list">
              {MODES.slice(1).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`mode-btn ${selectedMode === mode ? "is-active" : ""}`}
                  onClick={() => setSelectedMode(mode)}
                >
                  <div className="btn-side">
                    <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
                      {mode === "Dev Mode" ? "terminal" : "tune"}
                    </span>
                    <span>{mode}</span>
                  </div>
                  <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                    expand_more
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel-block">
            <div className="section-head-with-action">
              <h3 className="section-title">Active Agents</h3>
              <button className="small-icon-btn" type="button">
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                  add
                </span>
              </button>
            </div>
            <div className="agent-stack">
              {AGENTS.map((agent) => (
                <div key={agent.name} className="agent-entry">
                  <div className={`agent-dot ${agent.color}`}>
                    <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                      {agent.icon}
                    </span>
                    <span
                      className={`status-dot status-dot-${agent.active ? "active" : "idle"}`}
                      title={agent.active ? "활성" : "대기"}
                    />
                  </div>
                  <div className="agent-copy">
                    <p className="agent-name">{agent.name}</p>
                    <p className={`agent-state ${agent.active ? "agent-state-active" : ""}`}>
                      {agent.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel-block">
            <h3 className="section-title">Enabled Tools</h3>
            <div className="tool-list">
                {TOOLS.map((tool) => (
                  <div key={tool} className="tool-item">
                    <IconBadge
                      icon={tool === "웹 브라우저" ? "public" : tool === "Python Repl" ? "terminal" : "folder_open"}
                    />
                    <span className="tool-label">{tool}</span>
                  </div>
                ))}
              </div>
            </section>

        </aside>

        <section className="chat-panel">
          <div className="chat-scroll">
            <div className="chat-content">
              {messages.map((message) => (
                <MessageCard
                  key={message.id}
                  message={message}
                  onApprovePlan={handleApprovePlan}
                  onModifyPlan={handleModifyPlan}
                />
              ))}
              <div ref={chatEndRef} />
            </div>
          </div>

          <footer className="composer-wrap">
            <div className="composer-floating-actions">
              <button type="button" className="chip">
                <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                  add_circle
                </span>
                Use File
              </button>
              <button type="button" className="chip">
                <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                  tune
                </span>
                Configure Agent
              </button>
            </div>
            <div className="composer-box">
            <textarea
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={onEnterSubmit}
              placeholder="오케스트레이터에게 메시지 입력..."
              rows={1}
            />
              <div className="composer-actions">
                <button className="icon-btn" type="button">
                  <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
                    attach_file
                  </span>
                </button>
                <button className="icon-btn" type="button">
                  <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
                    mic
                  </span>
                </button>
                <button
                  className="send-btn"
                  type="button"
                  onClick={sendMessage}
                  disabled={!canSend}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
                    arrow_upward
                  </span>
                </button>
              </div>
            </div>
            <p className="disclaimer">AI can make mistakes. Verify critical information.</p>
          </footer>
        </section>

        <aside className="right-panel">
          <header className="right-head">
            <h3>Activity Log</h3>
            <div className="toolbar-icons">
              <button className="small-icon-btn" type="button" title="View Graph">
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                  hub
                </span>
              </button>
              <button className="small-icon-btn" type="button" title="View Logs">
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                  list_alt
                </span>
              </button>
            </div>
          </header>
          <div className="activity-scroll">
            <div className="activity-timeline">
              {activity.map((item) => (
                <ActivityCard key={item.id} item={item} />
              ))}
            </div>
          </div>
          <section className="system-resources">
            <h4>System Resources</h4>
            <div className="resource">
              <div className="resource-head">
                <span>Tokens Used (Session)</span>
                <span className="resource-value">{resourceToken.toLocaleString()}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill bar-fill-primary" style={{ width: `${tokenPercent}%` }} />
              </div>
            </div>
            <div className="resource">
              <div className="resource-head">
                <span>API Cost Est.</span>
                <span className="resource-value">${resourceCost.toFixed(2)}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill bar-fill-green" style={{ width: `${costPercent}%` }} />
              </div>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
