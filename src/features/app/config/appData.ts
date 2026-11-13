import type { AgentItem, LLMSettings, Message, MessageType } from "@/types/chat";
import { createDefaultLlmSettings, getPromptForModel } from "@/features/ai/catalog";

export const LLM_CONFIG: LLMSettings = createDefaultLlmSettings();

export const getModelSystemPrompt = (model?: string, providerId?: LLMSettings["providerId"]) => {
  return getPromptForModel(model, providerId);
};

export const LLM_SYSTEM_PROMPT = getModelSystemPrompt(LLM_CONFIG.model, LLM_CONFIG.providerId);

// 기본 에이전트는 특정 개발 역할에 한정하지 않고 사용자 요청을 직접 수행합니다.
const DEFAULT_AGENT_PROMPT_SECTIONS = [
  "사용자의 요청을 이해하고 조사, 계획, 구현 등 필요한 작업을 직접 수행해.",
  "다른 에이전트가 있으면 필요에 따라 협업해.",
];

export const composeSystemPrompt = (...sections: Array<string | undefined>) => {
  return sections
    .map((section) => section?.trim())
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
};

export const composeAgentSystemPrompt = (
  model: string | undefined,
  ...sections: Array<string | undefined>
) => {
  return composeSystemPrompt(getModelSystemPrompt(model), ...sections);
};

export const SESSION_MESSAGES: Message[] = [];

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
    name: "젬",
    icon: "account_tree",
    status: "Active",
    color: "indigo",
    active: true,
    role: "main",
    model: "gpt-5.4",
    prompt: composeSystemPrompt(...DEFAULT_AGENT_PROMPT_SECTIONS),
    tools: ["Web Search", "File System"],
    mcpServers: [],
    skills: [],
  },
];

export const TOOLS: string[] = ["Web Search", "Python Repl", "File System"];
export const LLM_ALLOWED_MESSAGE_TYPES: MessageType[] = [
  "text",
  "plan",
  "search",
  "typing",
] as const;
