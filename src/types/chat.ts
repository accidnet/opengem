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

export type AgentRole = "main" | "sub";

export type AgentItem = {
  name: string;
  icon: string;
  status: string;
  color: AgentColor;
  active?: boolean;
  /** 채팅 수신 에이전트 역할: main은 실제 LLM 호출 대상, sub는 보조 에이전트 */
  role?: AgentRole;
  model?: string;
  prompt?: string;
  tools?: string[];
  mcpServers?: string[];
  skills?: string[];
};

export type SessionItem = {
  id: string;
  title: string;
  updatedAt: number;
  modeName: string;
  active?: boolean;
};

export type SessionDetail = {
  session: SessionItem;
  messages: Message[];
};

export type ThemeMode = "dark" | "light";

export type IconBadgeProps = {
  icon: string;
  text?: string;
  color?: string;
};

export type LLMConfig = {
  providerKind: "api_key" | "chatgpt_oauth";
  baseUrl: string;
  model: string;
  apiKey?: string;
};

export type LLMSettings = LLMConfig & {
  chatgptLoggedIn: boolean;
  chatgptEmail?: string;
};

export type ResolvedLLMSettings = LLMConfig & {
  accessToken?: string;
  accountId?: string;
};

export type OperationModeState = {
  modes: string[];
  selectedMode: string;
};
