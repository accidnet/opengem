import type { AgentColor } from "@/types/chat";
import type { ModeIcon } from "@/data/appData";

import type { AgentIconOption } from "./types";

export const MODE_ICON_LABELS: Record<ModeIcon, string> = {
  smart_toy: "스마트 토이",
  terminal: "터미널",
  tune: "커스텀",
  bolt: "볼트",
  build: "빌드",
  settings: "설정",
  rocket_launch: "런치",
  integration_instructions: "연동",
};

export const AGENT_COLOR_OPTIONS: AgentColor[] = ["indigo", "emerald", "amber", "violet", "rose"];

export const AGENT_COLOR_LABELS: Record<AgentColor, string> = {
  indigo: "인디고",
  emerald: "에메랄드",
  amber: "앰버",
  violet: "바이올렛",
  rose: "로즈",
};

export const AGENT_ICON_OPTIONS: readonly AgentIconOption[] = [
  "account_tree",
  "travel_explore",
  "code",
  "design_services",
  "database",
  "smart_toy",
  "terminal",
  "rocket_launch",
] as const;

export const DEFAULT_AGENT_MODEL = "gpt-5.4";
