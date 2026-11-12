import { invoke } from "@tauri-apps/api/core";

export type AgentScope = { modeName: string; agentId: string };
export type AgentMemory = { content: string; updatedAt: number | null };
export type AgentRoutine = AgentScope & {
  id: string;
  instruction: string;
  intervalMinutes: number;
  enabled: boolean;
  checkpoint: number;
  nextRunAt: number;
  lastRunAt: number | null;
  lastError: string | null;
  mailboxEmail: string | null;
};
export type ClaimedRoutine = AgentRoutine & {
  leaseId: string;
  leaseExpiresAt: number;
  agentName: string;
  agentPrompt: string | null;
  agentModel: string | null;
};
export type AgentReport = {
  id: string;
  routineId: string;
  content: string;
  createdAt: number;
  status: "success" | "error";
};
export type EmailSettings = {
  provider: "gmail";
  clientId: string;
  hasClientSecret: boolean;
  connected: boolean;
  email: string | null;
  loginPending: boolean;
  lastError: string | null;
};
export type EmailMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: number;
  url: string;
  truncated: boolean;
};
export type EmailPage = {
  messages: EmailMessage[];
  since: number;
  until: number;
  nextPageToken?: string | null;
  accountEmail: string;
};

// 에이전트 식별자는 모델 출력 대신 현재 대화의 신뢰된 범위에서만 전달합니다.
export const getAgentMemory = (scope: AgentScope) => invoke<AgentMemory>("get_agent_memory", scope);
export const getAgentRecentContext = (scope: AgentScope) =>
  invoke<string>("get_agent_recent_context", scope);
export const saveAgentMemory = (
  input: AgentScope & { content: string; expectedUpdatedAt: number | null }
) => invoke<AgentMemory>("save_agent_memory", { input });
export const listAgentRoutines = (scope: AgentScope) =>
  invoke<AgentRoutine[]>("list_agent_routines", scope);
export const saveEmailRoutine = (
  input: AgentScope & { instruction: string; intervalMinutes: number; enabled?: boolean }
) => invoke<AgentRoutine>("save_email_routine", { input });
export const setAgentRoutineEnabled = (
  input: AgentScope & { routineId: string; enabled: boolean }
) => invoke<void>("set_agent_routine_enabled", input);
export const deleteAgentRoutine = (input: AgentScope & { routineId: string }) =>
  invoke<void>("delete_agent_routine", input);
export const runAgentRoutineNow = (input: AgentScope & { routineId: string }) =>
  invoke<void>("run_agent_routine_now", input);
export const listAgentReports = (scope: AgentScope) =>
  invoke<AgentReport[]>("list_agent_reports", scope);
export const claimDueEmailRoutines = () => invoke<ClaimedRoutine[]>("claim_due_email_routines");
export const completeEmailRoutine = (input: {
  routineId: string;
  leaseId: string;
  report: string;
  checkpoint?: number;
  error?: string;
  mailboxEmail?: string;
  messageIds?: string[];
}) => invoke<void>("complete_email_routine", { input });
export const getEmailRoutineSeenIds = (input: {
  routineId: string;
  leaseId: string;
  mailboxEmail: string;
  messageIds: string[];
}) => invoke<string[]>("get_email_routine_seen_ids", input);
export const getEmailSettings = () => invoke<EmailSettings>("get_email_settings");
export const saveEmailSettings = (input: { clientId: string; clientSecret?: string }) =>
  invoke<EmailSettings>("save_email_settings", { input });
export const beginEmailLogin = () => invoke<{ authorizationUrl: string }>("begin_email_login");
export const cancelEmailLogin = () => invoke<void>("cancel_email_login");
export const disconnectEmail = () => invoke<EmailSettings>("disconnect_email");
export const fetchEmailDigestMessages = (input: {
  since: number;
  until?: number;
  pageToken?: string;
}) => invoke<EmailPage>("fetch_email_digest_messages", { input });
export function notifyAgentWorkspace(scope: AgentScope) {
  window.dispatchEvent(new CustomEvent("agent-workspace-updated", { detail: scope }));
}
