export type MessageType = "text" | "plan" | "search" | "typing" | "status";

export type MessageSide = "agent" | "user" | "status";

export type Message = {
  id: string;
  /** 작성 당시 에이전트의 고유 ID. 이전 메시지는 sender 표시 이름만 가질 수 있습니다. */
  agentId?: string | null;
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
  isStreaming?: boolean;
};

export type ActivityState = "done" | "active" | "working" | "pending" | "failed";

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

export type CharacterItem = {
  id: string;
  name: string;
  image: string;
};

export type AgentItem = {
  agentId?: string;
  characterId?: string | null;
  name: string;
  icon: string;
  status: string;
  color: AgentColor;
  active?: boolean;
  /** 모드 안에서 표시하는 역할입니다. 전체 대화에는 두 역할 모두 참여합니다. */
  role?: AgentRole;
  model?: string;
  prompt?: string;
  tools?: string[];
  mcpServers?: string[];
  skills?: string[];
};

export type SessionItem = {
  /** 전체 대화는 null이며, 개별 대화에는 대상 에이전트의 고정 ID를 저장합니다. */
  agentId?: string | null;
  id: string;
  title: string;
  updatedAt: number;
  modeName: string;
  projectPaths: string[];
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
  providerId: "openai" | "anthropic" | "google" | "openrouter" | "custom";
  providerKind: "api-key" | "oauth";
  baseUrl: string;
  model: string;
  apiKey?: string;
};

export type LLMSettings = LLMConfig & {
  loggedIn: boolean;
  email?: string;
  openaiOauthEnabled: boolean;
  openaiOauthPriority: number;
  openaiApiKeyEnabled: boolean;
  openaiApiKeyPriority: number;
};

export type ResolvedLLMSettings = LLMConfig & {
  accessToken?: string;
  accountId?: string;
  openaiOauthEnabled?: boolean;
  openaiOauthPriority?: number;
  openaiApiKeyEnabled?: boolean;
  openaiApiKeyPriority?: number;
};

export type OperationModeItem = {
  name: string;
  projectPaths: string[];
  defaultModel?: string;
};

export type OperationModeState = {
  modes: string[];
  selectedMode: string;
  items: OperationModeItem[];
};
