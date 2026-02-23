export type MessageType = "text" | "plan" | "search" | "typing" | "status";

export type MessageSide = "agent" | "user" | "status";

export type Message = {
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

export type ActivityState = "done" | "active" | "working" | "pending";

export type ActivityItem = {
  id: string;
  source: string;
  byline?: string;
  text: string;
  state: ActivityState;
  progress?: ActivityState[];
  faded?: boolean;
};

export type AgentColor = "indigo" | "emerald" | "amber" | "violet" | "rose";

export type AgentItem = {
  name: string;
  icon: string;
  status: string;
  color: AgentColor;
  active?: boolean;
};

export type SessionItem = {
  name: string;
  time: string;
  active?: boolean;
};

export type ThemeMode = "dark" | "light";

export type IconBadgeProps = {
  icon: string;
  text?: string;
  color?: string;
};

export type LLMConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
};
