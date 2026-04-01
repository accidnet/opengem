import type { AgentItem } from "../../types/chat";

export type StartChatgptLoginPayload = {
  authorizationUrl: string;
};

export type OperationModeInput = {
  name: string;
  originalName?: string;
  projectPaths?: string[];
  defaultModel?: string;
};

export type PersistedAgent = Omit<AgentItem, "status">;

export type DelegationTask = {
  agentName: string;
  goal: string;
  deliverable: string;
  priority?: "high" | "medium" | "low";
};

export type DelegationDecision = {
  shouldDelegate: boolean;
  reasoning?: string;
  tasks: DelegationTask[];
};

export type SubagentExecutionResult = {
  agentName: string;
  status: "completed" | "failed";
  summary: string;
  deliverable: string;
  priority: "high" | "medium" | "low";
};

export const toAgentStatus = (active?: boolean) => {
  return active ? "Active" : "Offline";
};

export const normalizeAgentsForUi = (items: PersistedAgent[]) => {
  return items.map((agent) => ({
    ...agent,
    status: toAgentStatus(agent.active),
  }));
};

export const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return "알 수 없는 오류가 발생했습니다.";
};

export const parseJsonObject = <T,>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
};

export const normalizePriority = (value?: string): "high" | "medium" | "low" => {
  if (value === "high" || value === "low") {
    return value;
  }

  return "medium";
};
