import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { loadAgentContext } from "@/features/agent/context";
import { runComputerTask } from "@/features/computer/runtime";

import { hasAvailableProvider } from "@/features/ai/providers/utils";
import { getAvailableProviders, getChatSession } from "@/features/backend/api";
import { resolveAgentModel } from "@/features/agent/model";
import { getErrorMessage } from "@/features/app/appHelpers";
import { getGlobalPrompt } from "@/features/app/globalPrompt";
import { runChatAgentTurn } from "@/pages/chat/chatAgentTurn";
import type { AgentItem, Message, ResolvedLLMSettings, SessionItem } from "@/types/chat";
import { buildTypingMessage, nowTime } from "@/pages/chat/utils";
import { finalizeAssistantMessage } from "@/pages/chat/activity";
import { resolveConversationParticipants } from "@/pages/chat/conversationTarget";

type SendMessageDeps = {
  executionMode: "chat" | "codex" | "computer";
  agents: AgentItem[];
  targetAgentId: string | null;
  conversationLockRef: MutableRefObject<boolean>;
  canSend: boolean;
  currentSessionId: string | null;
  ensureSession: (text: string) => Promise<SessionItem>;
  inputValue: string;
  messages: Message[];
  modes: string[];
  persistMessage: (sessionId: string, message: Message) => Promise<void>;
  refreshSessions: (modes: string[], nextSessionId: string | null) => Promise<void>;
  resolveProviderSettings: () => Promise<ResolvedLLMSettings>;
  setInputValue: Dispatch<SetStateAction<string>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setOpenSelectedModeSignal: Dispatch<SetStateAction<number>>;
  setResourceCost: Dispatch<SetStateAction<number>>;
  setResourceToken: Dispatch<SetStateAction<number>>;
  maxAgentSteps?: number | null;
};

class MessageSaveError extends Error {}

const DEFAULT_MAX_AGENT_STEPS = 12;

const finishAssistantMessage = (
  setMessages: Dispatch<SetStateAction<Message[]>>,
  typingMessageId: string,
  nextMessage: Message
) => {
  setMessages((prev) => finalizeAssistantMessage(prev, typingMessageId, nextMessage));
};

const updateStreamingStatusMessage = (
  setMessages: Dispatch<SetStateAction<Message[]>>,
  messageId: string,
  nextText: string,
  messageType: Message["type"] = "typing"
) => {
  setMessages((prev) =>
    prev.map((entry) =>
      entry.id === messageId
        ? {
            ...entry,
            type: messageType,
            isStreaming: true,
            text: nextText,
          }
        : entry
    )
  );
};

function updateUsageMetrics(
  totalTokens: number,
  setResourceToken: Dispatch<SetStateAction<number>>,
  setResourceCost: Dispatch<SetStateAction<number>>
) {
  if (totalTokens <= 0) {
    return;
  }

  setResourceToken((prev) => Math.min(9999, prev + totalTokens));
  const estimatedCost = totalTokens * 0.000005;
  setResourceCost((prev) => Number((prev + estimatedCost).toFixed(3)));
}

function createAssistantMessage(base: Message, text: string): Message {
  return {
    ...base,
    type: "text",
    isStreaming: false,
    byline: nowTime(),
    text,
  };
}

export function useChatSendMessage({
  executionMode,
  agents,
  targetAgentId,
  conversationLockRef,
  canSend,
  currentSessionId,
  ensureSession,
  inputValue,
  messages,
  modes,
  persistMessage,
  refreshSessions,
  resolveProviderSettings,
  setInputValue,
  setIsLoading,
  setMessages,
  setOpenSelectedModeSignal,
  setResourceCost,
  setResourceToken,
  maxAgentSteps = DEFAULT_MAX_AGENT_STEPS,
}: SendMessageDeps) {
  const activeCodexRequest = useRef<string | null>(null);
  const [isCodexRunning, setIsCodexRunning] = useState(false);
  const [isComputerRunning, setIsComputerRunning] = useState(false);
  const activeComputerRequest = useRef<AbortController | null>(null);
  const cancelComputerTask = () => activeComputerRequest.current?.abort();
  useEffect(() => {
    const stop = () => activeComputerRequest.current?.abort();
    window.addEventListener("computer-stop", stop);
    return () => {
      window.removeEventListener("computer-stop", stop);
      stop();
    };
  }, []);

  const cancelCodexTask = () => {
    const requestId = activeCodexRequest.current;
    if (!requestId) return;
    void invoke("cancel_codex_task", { requestId }).catch((error) => {
      setMessages((previous) => [
        ...previous,
        {
          id: "cancel-error-" + Date.now(),
          side: "status",
          type: "status",
          statusText: "작업 취소 실패: " + getErrorMessage(error),
        },
      ]);
    });
  };

  const sendMessage = async (): Promise<void> => {
    if (!canSend || conversationLockRef.current) {
      return;
    }

    const text = inputValue.trim();
    if (!text) {
      return;
    }

    const participants = resolveConversationParticipants(agents, targetAgentId);
    const firstParticipant = participants[0];
    if (!firstParticipant) return;
    conversationLockRef.current = true;

    const isFirstMessageInFreshSession = currentSessionId === null && messages.length === 0;
    if (isFirstMessageInFreshSession) {
      setOpenSelectedModeSignal((prev) => prev + 1);
    }

    const userMessage: Message = {
      id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      side: "user",
      sender: "User",
      byline: nowTime(),
      avatarText: "U",
      type: "text",
      text,
    };

    const typingMessage = buildTypingMessage(firstParticipant);
    setMessages((prev) => [...prev, userMessage, typingMessage]);
    setInputValue("");
    setIsLoading(true);

    let activeSessionId: string | null = null;
    let activeAssistantMessage = typingMessage;

    try {
      const session = await ensureSession(text);
      // 한 요청의 관리·응답 단계는 같은 버전의 전역 지침을 사용합니다.
      const [sessionDetail, globalPrompt] = await Promise.all([
        getChatSession(session.id),
        getGlobalPrompt(),
      ]);
      if (
        sessionDetail.session.modeName !== session.modeName ||
        (sessionDetail.session.agentId ?? null) !== targetAgentId
      ) {
        throw new Error("대화 대상이 일치하지 않습니다. 대화를 다시 열어 주세요.");
      }
      if (!targetAgentId && executionMode !== "chat") {
        throw new Error("Codex와 컴퓨터 제어는 개별 에이전트 대화에서 실행할 수 있습니다.");
      }
      const history = [...sessionDetail.messages, userMessage];
      await persistMessage(session.id, userMessage);
      activeSessionId = session.id;
      const agentScope = targetAgentId
        ? { modeName: sessionDetail.session.modeName, agentId: targetAgentId }
        : null;
      if (executionMode === "codex") {
        const requestId = crypto.randomUUID();
        const logs: string[] = [];
        // 다른 세션의 이벤트는 화면에 섞이지 않도록 요청 ID까지 확인합니다.
        const unlisten = await listen<{
          sessionId: string;
          agentId: string;
          requestId: string;
          type: "started" | "event" | "stderr";
          data: string;
        }>("codex-task-event", (event) => {
          const payload = event.payload;
          if (
            payload.sessionId !== session.id ||
            payload.agentId !== targetAgentId ||
            payload.requestId !== requestId
          )
            return;
          let description = "";
          if (payload.type === "started") {
            setIsCodexRunning(true);
            description = "Codex 실행 준비 완료";
          } else if (payload.type === "stderr") {
            description = payload.data.trim();
          } else {
            try {
              const parsed = JSON.parse(payload.data) as {
                type?: string;
                item?: {
                  type?: string;
                  command?: string;
                  status?: string;
                  exit_code?: number | null;
                };
              };
              if (parsed.type === "item.started" && parsed.item?.type === "command_execution")
                description = "명령 실행: " + (parsed.item.command ?? "");
              else if (
                parsed.type === "item.completed" &&
                parsed.item?.type === "command_execution"
              )
                description = `명령 종료: ${parsed.item.status ?? "상태 알 수 없음"}${parsed.item.exit_code == null ? "" : ` (exit ${parsed.item.exit_code})`}`;
              else if (parsed.type === "item.completed" && parsed.item?.type === "file_change")
                description = `파일 변경: ${parsed.item.status ?? "상태 알 수 없음"}`;
              else if (parsed.type === "turn.started") description = "Codex 작업 시작";
              else if (parsed.type === "turn.completed") description = "Codex 작업 완료";
              else if (parsed.type === "turn.failed" || parsed.type === "error")
                description = "Codex 작업 오류";
            } catch {
              description = "Codex 이벤트를 읽지 못했습니다.";
            }
          }
          if (!description) return;
          const bounded = description.slice(0, 500);
          if (logs.length < 100) logs.push(bounded);
          updateStreamingStatusMessage(setMessages, typingMessage.id, bounded);
        });
        activeCodexRequest.current = requestId;
        try {
          const result = await invoke<{ output: string }>("run_codex_task", {
            input: {
              sessionId: session.id,
              agentId: targetAgentId,
              requestId,
              globalPrompt,
              agentContext: agentScope
                ? await loadAgentContext(agentScope, firstParticipant.name)
                : "",
              prompt: text,
            },
          });
          const assistantMessage = createAssistantMessage(
            typingMessage,
            result.output || "Codex 작업이 완료되었습니다."
          );
          await persistMessage(session.id, assistantMessage);
          finishAssistantMessage(setMessages, typingMessage.id, assistantMessage);
        } finally {
          unlisten();
          activeCodexRequest.current = null;
          setIsCodexRunning(false);
          if (logs.length) {
            const logMessage: Message = {
              id: "codex-log-" + requestId,
              side: "agent",
              type: "search",
              agentId: targetAgentId,
              sender: firstParticipant.name + " Codex",
              byline: nowTime(),
              icon: "terminal",
              text: "Codex 실행 기록",
              logs,
            };
            setMessages((previous) => [...previous, logMessage]);
            try {
              await persistMessage(session.id, logMessage);
            } catch {
              /* 원래 실행 결과를 우선합니다. */
            }
          }
        }
        return;
      }
      const [currentSettings, availableProviders] = await Promise.all([
        resolveProviderSettings(),
        getAvailableProviders().catch(() => []),
      ]);

      if (!hasAvailableProvider(availableProviders) && currentSettings.providerId !== "custom") {
        throw new Error(
          "사용 가능한 모델이 없습니다. 우측 상단의 사용자 버튼을 눌러 Provider를 설정하세요."
        );
      }
      const modelContext = { activeSettings: currentSettings, availableProviders };
      if (executionMode === "computer") {
        const activeSettings = await resolveAgentModel(firstParticipant.model, modelContext);
        const controller = new AbortController();
        activeComputerRequest.current = controller;
        setIsComputerRunning(true);
        try {
          const result = await runComputerTask({
            text,
            globalPrompt,
            agentName: firstParticipant.name,
            agentPrompt: firstParticipant.prompt,
            agentContext: agentScope
              ? await loadAgentContext(agentScope, firstParticipant.name)
              : "",
            settings: activeSettings,
            runtimeApiUrl: activeSettings.baseUrl,
            signal: controller.signal,
            maxSteps: maxAgentSteps,
            onProgress: (description) =>
              updateStreamingStatusMessage(setMessages, activeAssistantMessage.id, description),
          });
          const assistantMessage = createAssistantMessage(activeAssistantMessage, result.text);
          await persistMessage(session.id, assistantMessage);
          finishAssistantMessage(setMessages, activeAssistantMessage.id, assistantMessage);
          updateUsageMetrics(result.totalTokens, setResourceToken, setResourceCost);
        } finally {
          activeComputerRequest.current = null;
          setIsComputerRunning(false);
        }
        return;
      }

      const recordMessage = async (message: Message) => {
        try {
          await persistMessage(session.id, message);
        } catch (error) {
          throw new MessageSaveError(`대화 기록을 저장하지 못했습니다. ${getErrorMessage(error)}`);
        }
        history.push(message);
      };

      // 앞선 참여자의 도구 기록과 답변을 같은 세션에 저장한 뒤 다음 참여자를 실행합니다.
      for (const agent of participants) {
        if (agent !== firstParticipant) {
          activeAssistantMessage = buildTypingMessage(agent);
          const placeholder = activeAssistantMessage;
          setMessages((prev) => [...prev, placeholder]);
        }
        const reply = activeAssistantMessage;
        let completed: Message;
        try {
          const activeSettings = await resolveAgentModel(agent.model, modelContext);
          const response = await runChatAgentTurn({
            agent,
            participants,
            scope: agentScope,
            text,
            globalPrompt,
            projectPaths: sessionDetail.session.projectPaths,
            activeSettings,
            history,
            maxAgentSteps,
            onProgress: (description, type) =>
              updateStreamingStatusMessage(setMessages, reply.id, description, type),
            onToolMessage: async (message) => {
              await recordMessage(message);
              setMessages((prev) => [...prev, message]);
            },
          });
          completed = createAssistantMessage(reply, response.text);
          updateUsageMetrics(response.totalTokens, setResourceToken, setResourceCost);
        } catch (error) {
          if (error instanceof MessageSaveError) throw error;
          completed = {
            ...createAssistantMessage(reply, `응답 실패: ${getErrorMessage(error)}`),
            icon: "error",
          };
        }
        await recordMessage(completed);
        finishAssistantMessage(setMessages, reply.id, completed);
      }
    } catch (error) {
      const reason = getErrorMessage(error);
      if (!activeSessionId) {
        // 저장 전에 실패한 입력은 다시 보낼 수 있게 복구합니다.
        setMessages((prev) => prev.filter((message) => message.id !== userMessage.id));
        setInputValue((draft) => draft || inputValue);
      }
      const errorMessage: Message =
        activeSessionId && executionMode !== "chat"
          ? {
              ...createAssistantMessage(
                activeAssistantMessage,
                executionMode === "codex"
                  ? `Codex 실행 종료: ${reason}`
                  : `컴퓨터 제어 실패: ${reason}`
              ),
              icon: "error",
            }
          : {
              id: activeAssistantMessage.id,
              side: "status",
              type: "status",
              statusText: reason,
            };
      finishAssistantMessage(setMessages, activeAssistantMessage.id, errorMessage);

      if (activeSessionId) {
        try {
          await persistMessage(activeSessionId, errorMessage);
        } catch {
          // 저장소 오류도 화면에서 확인할 수 있도록 원래 안내를 유지합니다.
        }
      }
    } finally {
      if (activeSessionId) {
        try {
          await refreshSessions(modes, activeSessionId);
        } catch (error) {
          const reason = getErrorMessage(error);
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              side: "status",
              type: "status",
              statusText: `대화 목록을 갱신하지 못했습니다. ${reason}`,
            },
          ]);
        }
      }
      conversationLockRef.current = false;
      setIsLoading(false);
    }
  };

  return { sendMessage, cancelCodexTask, isCodexRunning, cancelComputerTask, isComputerRunning };
}
