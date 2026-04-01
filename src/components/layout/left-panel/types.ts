import type { AgentColor, AgentItem } from "@/types/chat";
import type { Mode, ModeIcon } from "@/data/appData";

export type DraftModeItem = {
  id: string;
  name: string;
  icon: ModeIcon;
  originalName?: Mode;
  projectPaths: string[];
  defaultModel?: string;
};

export type DraftAgentItem = AgentItem & {
  id: string;
};

export type AgentSettingsTab = "create" | "list";

export type AgentIconOption =
  | "account_tree"
  | "travel_explore"
  | "code"
  | "design_services"
  | "database"
  | "smart_toy"
  | "terminal"
  | "rocket_launch";

export type AgentColorOption = AgentColor;
