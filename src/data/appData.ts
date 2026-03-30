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
  "?뱀떊? 硫???먯씠?꾪듃 ?ㅼ??ㅽ듃?덉씠???섍꼍??AI ?ㅼ??ㅽ듃?덉씠?곗엯?덈떎. ?ъ슜?먯쓽 ?붿껌?????援ъ껜?곸씠怨??ㅽ뻾 媛?ν븳 ?듬????쒓뎅?대줈 ?쒓났?⑸땲?? ?듬?? 媛꾧껐???꾩엯遺, ?듭떖 ?붿빟, 沅뚯옣 ?≪뀡 ?쒖꽌濡??묒꽦?⑸땲??";

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
    name: "Orchestrator",
    icon: "account_tree",
    status: "Active",
    color: "indigo",
    active: true,
    role: "main",
    model: "gpt-5.4",
    prompt: "Coordinate the overall task, decide when specialist help is needed, and produce the final answer.",
    tools: ["Web Search", "File System"],
    mcpServers: ["linear"],
    skills: ["task-routing"],
  },
  {
    name: "Frontend Developer",
    icon: "travel_explore",
    status: "Active",
    color: "emerald",
    active: true,
    role: "sub",
    model: "gpt-5.4",
    prompt: "Focus on UI, interaction, and frontend implementation details.",
    tools: ["Web Search", "File System"],
    mcpServers: ["figma"],
    skills: ["design-review"],
  },
  {
    name: "Backend Developer",
    icon: "code",
    status: "Active",
    color: "amber",
    active: true,
    role: "sub",
    model: "gpt-5.4-mini",
    prompt: "Focus on server logic, APIs, data flow, and backend implementation details.",
    tools: ["File System"],
    mcpServers: ["postgres"],
    skills: ["api-design"],
  },
];

export const TOOLS: string[] = ["Web Search", "Python Repl", "File System"];
export const LLM_ALLOWED_MESSAGE_TYPES: MessageType[] = [
  "text",
  "plan",
  "search",
  "typing",
] as const;

