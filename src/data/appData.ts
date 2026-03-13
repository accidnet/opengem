import type { ActivityItem, AgentItem, LLMSettings, Message, MessageType } from "@/types/chat";

const env = import.meta.env;

export const LLM_CONFIG: LLMSettings = {
  providerKind: "api_key",
  baseUrl: env.VITE_LLM_BASE_URL || "https://api.openai.com/v1",
  model: env.VITE_LLM_MODEL || "gpt-4o-mini",
  apiKey: env.VITE_LLM_API_KEY,
  chatgptLoggedIn: false,
};

export const LLM_SYSTEM_PROMPT =
  "당신은 멀티 에이전트 오케스트레이션 환경의 AI 오케스트레이터입니다. 사용자의 요청에 대해 구체적이고 실행 가능한 답변을 한국어로 제공합니다. 답변은 간결한 도입부, 핵심 요약, 권장 액션 순서로 작성합니다.";

export const SESSION_MESSAGES: Message[] = [];

export const INITIAL_ACTIVITY: ActivityItem[] = [
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

export type Mode = string;

export const MODES: Mode[] = ["Orchestration", "Dev Mode", "Custom"];

export const MODE_ICON_OPTIONS = [
  "smart_toy",
  "terminal",
  "tune",
  "bolt",
  "build",
  "settings",
  "rocket_launch",
  "integration_instructions",
] as const;

export type ModeIcon = (typeof MODE_ICON_OPTIONS)[number];

export const DEFAULT_MODE_ICONS: Record<Mode, ModeIcon> = {
  Orchestration: "smart_toy",
  "Dev Mode": "terminal",
  Custom: "tune",
};

export const AGENTS: AgentItem[] = [
  {
    name: "오케스트레이터",
    icon: "account_tree",
    status: "대기 중",
    color: "indigo",
    active: true,
    model: "gpt-5.4",
    prompt: "전체 작업을 조율하고 필요한 에이전트에게 역할을 분배해.",
    tools: ["웹 브라우저", "파일 시스템"],
    mcpServers: ["linear"],
    skills: ["task-routing"],
  },
  {
    name: "프론트엔드 개발자",
    icon: "travel_explore",
    status: "수집 중...",
    color: "emerald",
    active: true,
    model: "gpt-5.4",
    prompt: "프론트엔드 UI와 상호작용을 구현하고 시각 완성도를 높여.",
    tools: ["웹 브라우저", "파일 시스템"],
    mcpServers: ["figma"],
    skills: ["design-review"],
  },
  {
    name: "백엔드 개발자",
    icon: "code",
    status: "대기 중",
    color: "amber",
    active: true,
    model: "gpt-5.4-mini",
    prompt: "서버 로직, API, 데이터 흐름을 설계하고 구현해.",
    tools: ["파일 시스템"],
    mcpServers: ["postgres"],
    skills: ["api-design"],
  },
];

export const TOOLS: string[] = ["웹 브라우저", "Python Repl", "파일 시스템"];

export const LLM_ALLOWED_MESSAGE_TYPES: MessageType[] = [
  "text",
  "plan",
  "search",
  "typing",
] as const;
