import type { ActivityItem, AgentItem, LLMSettings, Message, MessageType } from "@/types/chat";
import { createDefaultLlmSettings, getPromptForModel } from "./llmCatalog";

export const LLM_CONFIG: LLMSettings = createDefaultLlmSettings();

export const getModelSystemPrompt = (model?: string, providerId?: LLMSettings["providerId"]) => {
  return getPromptForModel(model, providerId);
};

export const LLM_SYSTEM_PROMPT = getModelSystemPrompt(LLM_CONFIG.model, LLM_CONFIG.providerId);

const ORCHESTRATOR_PROMPT_SECTIONS = [
  "You are the primary orchestration agent.",
  "Own the overall conversation, decide when specialist help is needed, and produce the final user-facing answer.",
  "Break complex work into clear tasks, keep track of progress, and avoid delegating simple requests unnecessarily.",
];

const FRONTEND_PROMPT_SECTIONS = [
  "You are a frontend specialist subagent.",
  "Focus on UI structure, interaction flow, accessibility, visual polish, and frontend implementation details.",
  "Return concise implementation guidance or findings for the main agent to synthesize.",
];

const BACKEND_PROMPT_SECTIONS = [
  "You are a backend specialist subagent.",
  "Focus on server behavior, APIs, data flow, persistence, validation, and reliability concerns.",
  "Return concise implementation guidance or findings for the main agent to synthesize.",
];

export const composeSystemPrompt = (...sections: Array<string | undefined>) => {
  return sections
    .map((section) => section?.trim())
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
};

export const composeAgentSystemPrompt = (model: string | undefined, ...sections: Array<string | undefined>) => {
  return composeSystemPrompt(getModelSystemPrompt(model), ...sections);
};

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
    prompt: composeSystemPrompt(...ORCHESTRATOR_PROMPT_SECTIONS),
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
    prompt: composeSystemPrompt(...FRONTEND_PROMPT_SECTIONS),
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
    prompt: composeSystemPrompt(...BACKEND_PROMPT_SECTIONS),
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
