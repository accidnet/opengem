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

export const MODES: Mode[] = ["Orchestrator", "Dev Mode", "Custom"];

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
  Orchestrator: "smart_toy",
  "Dev Mode": "terminal",
  Custom: "tune",
};

export const AGENTS: AgentItem[] = [
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

export const TOOLS: string[] = ["웹 브라우저", "Python Repl", "파일 시스템"];

export const LLM_ALLOWED_MESSAGE_TYPES: MessageType[] = [
  "text",
  "plan",
  "search",
  "typing",
] as const;
