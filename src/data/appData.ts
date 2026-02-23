import type {
  ActivityItem,
  AgentItem,
  LLMConfig,
  Message,
  MessageType,
  SessionItem,
} from "@/types/chat";

const env = import.meta.env;

export const LLM_CONFIG: LLMConfig = {
  baseUrl: env.VITE_LLM_BASE_URL || "https://api.openai.com/v1",
  model: env.VITE_LLM_MODEL || "gpt-4o-mini",
  apiKey: env.VITE_LLM_API_KEY,
};

export const LLM_SYSTEM_PROMPT =
  "당신은 멀티 에이전트 오케스트레이션 환경의 AI 오케스트레이터입니다. 사용자의 요청에 대해 구체적이고 실행 가능한 답변을 한국어로 제공합니다. 답변은 간결한 도입부, 핵심 요약, 권장 액션 순서로 작성합니다.";

export const SESSION_MESSAGES: Message[] = [
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
      "연구 에이전트가 2024년 AI 하드웨어 스타트업 상위 3곳을 선정하고, 공개 출처에서 자금 조달 데이터를 수집합니다.",
      "각 후보사의 기술 문서 및 백서를 검토한 뒤 핵심 차별화 요소를 정리합니다.",
      "분석 에이전트가 비교 표를 작성하고 주요 인사이트를 추출합니다.",
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
      "> 검색 결과 12건 발견",
      "> 높은 관련성 결과 필터링 중",
      "> 후보 추출 완료: [Cerebras, Groq, SambaNova]",
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

export const MODES = ["Orchestrator", "Dev Mode", "Custom"] as const;

export type Mode = (typeof MODES)[number];

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

export const SESSIONS: SessionItem[] = [
  { name: "Market Analysis #42", time: "Today, 10:23 AM", active: true },
  { name: "Code Review: Auth Service", time: "Yesterday" },
  { name: "Product Roadmap Q4", time: "Oct 24" },
];

export const LLM_ALLOWED_MESSAGE_TYPES: MessageType[] = [
  "text",
  "plan",
  "search",
  "typing",
] as const;
