import type { Dispatch, SetStateAction } from "react";

import { hasAvailableProvider } from "@/features/ai/providers/utils";
import { getChatSession } from "@/features/backend/api";
import { getProviderCatalog } from "@/lib/llm/catalog";
import { getErrorMessage } from "@/features/app/appHelpers";
import { composeChatSystemPrompt } from "@/features/chat/promptComposer";
import {
  createChatToolDefinitions,
  executeChatToolCall,
  type ChatToolExecutionResult,
} from "@/features/chat/toolRuntime";
import { request, type LLMMessage, type LLMToolCall } from "@/lib/llm";
import type {
  ActivityItem,
  AgentItem,
  Message,
  ResolvedLLMSettings,
  SessionItem,
} from "@/types/chat";
import {
  AGENT_COLOR_VALUES,
  buildActivity,
  buildConversationMessages,
  buildTypingMessage,
  nowTime,
} from "@/pages/chat/utils";

type SendMessageDeps = {
  agents: AgentItem[];
  canSend: boolean;
  currentSessionId: string | null;
  ensureSession: (text: string) => Promise<SessionItem>;
  inputValue: string;
  messages: Message[];
  modes: string[];
  persistMessage: (sessionId: string, message: Message) => Promise<void>;
  refreshSessions: (modes: string[], nextSessionId: string | null) => Promise<void>;
  resolveProviderSettings: () => Promise<ResolvedLLMSettings>;
  setActivity: Dispatch<SetStateAction<ActivityItem[]>>;
  setInputValue: Dispatch<SetStateAction<string>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setOpenSelectedModeSignal: Dispatch<SetStateAction<number>>;
  setResourceCost: Dispatch<SetStateAction<number>>;
  setResourceToken: Dispatch<SetStateAction<number>>;
  maxAgentSteps?: number | null;
};

type AgentLoopResult = {
  text: string;
  totalTokens: number;
};

const DEFAULT_MAX_AGENT_STEPS = 12;

const replaceTypingMessage = (
  setMessages: Dispatch<SetStateAction<Message[]>>,
  typingMessageId: string,
  nextMessage: Message
) => {
  setMessages((prev) => prev.map((entry) => (entry.id === typingMessageId ? nextMessage : entry)));
};

async function publishGuardMessage(input: {
  sessionId: string;
  typingMessage: Message;
  text: string;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  persistMessage: (sessionId: string, message: Message) => Promise<void>;
  refreshSessions: (modes: string[], nextSessionId: string | null) => Promise<void>;
  modes: string[];
}) {
  const nextMessage: Message = {
    ...input.typingMessage,
    type: "text",
    text: input.text,
  };

  replaceTypingMessage(input.setMessages, input.typingMessage.id, nextMessage);
  await input.persistMessage(input.sessionId, nextMessage);
  await input.refreshSessions(input.modes, input.sessionId);
}

const moveMessageToBottom = (
  setMessages: Dispatch<SetStateAction<Message[]>>,
  messageId: string,
  nextMessage: Message
) => {
  setMessages((prev) => [...prev.filter((entry) => entry.id !== messageId), nextMessage]);
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
            text: nextText,
          }
        : entry
    )
  );
};

function createToolLogMessage(
  agentName: string | undefined,
  result: ChatToolExecutionResult
): Message {
  const preview =
    result.content.length > 500
      ? `${result.content.slice(0, 500)}\n...`
      : result.content || "(no output)";

  return {
    id: `tool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    side: "agent",
    sender: `${agentName ?? "Assistant"} Tool`,
    byline: nowTime(),
    icon: "integration_instructions",
    iconColor: "#7dd3fc",
    type: "search",
    text: `${result.toolName}: ${result.title}`,
    logs: [...result.logs, preview],
  };
}

function createToolErrorMessage(
  agentName: string | undefined,
  toolName: string,
  reason: string
): Message {
  return {
    id: `tool-error-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    side: "agent",
    sender: `${agentName ?? "Assistant"} Tool`,
    byline: nowTime(),
    icon: "error",
    iconColor: "#fda4af",
    type: "search",
    text: `${toolName} failed`,
    logs: [reason],
  };
}

function supportsStructuredToolLoop(activeSettings: ResolvedLLMSettings): boolean {
  if (activeSettings.providerKind === "oauth") {
    return false;
  }
  const provider = getProviderCatalog(activeSettings.providerId);
  return provider.protocol === "openai-compatible";
}

function normalizeFinishReason(reason: string | undefined): string {
  return reason?.trim().toLowerCase() ?? "";
}

function hasToolName(toolCall: LLMToolCall): boolean {
  return toolCall.name.trim().length > 0;
}

function getUsableToolCalls(toolCalls: LLMToolCall[] | undefined): LLMToolCall[] {
  if (!toolCalls?.length) {
    return [];
  }

  return toolCalls.filter(hasToolName);
}

function shouldContinueAgentLoop(input: {
  toolCalls: LLMToolCall[];
  finishReason?: string;
  responseText: string;
}): boolean {
  if (input.toolCalls.length > 0) {
    return true;
  }

  const finishReason = normalizeFinishReason(input.finishReason);
  if (finishReason === "tool_calls" || finishReason === "function_call") {
    return true;
  }

  if (finishReason === "stop" || finishReason === "end_turn" || finishReason === "completed") {
    return false;
  }

  return input.responseText.trim().length === 0;
}

async function runMainAgentLoop(input: {
  sessionId: string;
  projectPaths: string[];
  mainAgent: AgentItem;
  activeSettings: ResolvedLLMSettings;
  baseMessages: LLMMessage[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setActivity: Dispatch<SetStateAction<ActivityItem[]>>;
  persistMessage: (sessionId: string, message: Message) => Promise<void>;
  activeAssistantMessageId: string;
  maxAgentSteps?: number | null;
}): Promise<AgentLoopResult> {
  const toolDefinitions = supportsStructuredToolLoop(input.activeSettings)
    ? createChatToolDefinitions(input.projectPaths)
    : [];
  const systemPrompt = composeChatSystemPrompt({
    model: input.mainAgent.model?.trim() || input.activeSettings.model,
    providerId: input.activeSettings.providerId,
    agentPrompt: input.mainAgent.prompt,
    projectPaths: input.projectPaths,
    tools: toolDefinitions,
  });
  const workingMessages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    ...input.baseMessages,
  ];

  let totalTokens = 0;
  let finalText = "";
  let step = 0;

  while (true) {
    if (
      typeof input.maxAgentSteps === "number" &&
      input.maxAgentSteps > 0 &&
      step >= input.maxAgentSteps
    ) {
      return {
        text: finalText || "(응답이 비어 있습니다.)",
        totalTokens,
      };
    }

    step += 1;
    let streamedText = "";
    const accumulatedText = finalText;

    updateStreamingStatusMessage(
      input.setMessages,
      input.activeAssistantMessageId,
      accumulatedText || (toolDefinitions.length > 0 ? "Thinking with tools..." : "Thinking...")
    );

    const response = await request({
      providerId: input.activeSettings.providerId,
      providerKind: input.activeSettings.providerKind,
      apiBaseUrl: input.activeSettings.baseUrl,
      apiKey: input.activeSettings.apiKey,
      accessToken: input.activeSettings.accessToken,
      accountId: input.activeSettings.accountId,
      model:
        input.activeSettings.providerKind === "oauth"
          ? input.activeSettings.model
          : input.mainAgent.model?.trim() || input.activeSettings.model,
      messages: workingMessages,
      tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
      toolChoice: toolDefinitions.length > 0 ? "auto" : undefined,
      stream: true,
      onChunk: (chunk) => {
        streamedText += chunk;
        updateStreamingStatusMessage(
          input.setMessages,
          input.activeAssistantMessageId,
          `${accumulatedText}${streamedText}`,
          "text"
        );
      },
    });

    totalTokens += response.usage?.totalTokens ?? 0;

    const responseText = response.text || streamedText;
    const usableToolCalls = getUsableToolCalls(response.toolCalls);
    finalText = `${accumulatedText}${responseText}`;

    workingMessages.push({
      role: "assistant",
      content: responseText,
      ...(usableToolCalls.length > 0 ? { toolCalls: usableToolCalls } : {}),
    });

    if (
      !shouldContinueAgentLoop({
        toolCalls: usableToolCalls,
        finishReason: response.finishReason,
        responseText,
      })
    ) {
      return {
        text: finalText || "(응답이 비어 있습니다.)",
        totalTokens,
      };
    }

    if (usableToolCalls.length === 0) {
      updateStreamingStatusMessage(
        input.setMessages,
        input.activeAssistantMessageId,
        finalText || "Thinking..."
      );
      continue;
    }

    for (const toolCall of usableToolCalls) {
      updateStreamingStatusMessage(
        input.setMessages,
        input.activeAssistantMessageId,
        `Running tool: ${toolCall.name}`
      );

      try {
        const result = await executeChatToolCall(toolCall, input.projectPaths);
        const toolMessage = createToolLogMessage(input.mainAgent.name, result);
        input.setMessages((prev) => [...prev, toolMessage]);
        await input.persistMessage(input.sessionId, toolMessage);
        input.setActivity((prev) => [
          ...prev,
          buildActivity(`Tool completed: ${toolCall.name}`, input.mainAgent.name ?? "Assistant"),
        ]);

        workingMessages.push({
          role: "tool",
          name: toolCall.name,
          toolCallId: toolCall.id,
          content: result.content,
        });
      } catch (error) {
        const reason = getErrorMessage(error);
        const toolErrorMessage = createToolErrorMessage(
          input.mainAgent.name,
          toolCall.name,
          reason
        );
        input.setMessages((prev) => [...prev, toolErrorMessage]);
        await input.persistMessage(input.sessionId, toolErrorMessage);
        input.setActivity((prev) => [
          ...prev,
          buildActivity(`Tool failed: ${toolCall.name}`, input.mainAgent.name ?? "Assistant"),
        ]);

        workingMessages.push({
          role: "tool",
          name: toolCall.name,
          toolCallId: toolCall.id,
          content: `Tool ${toolCall.name} failed: ${reason}`,
        });
      }
    }
  }
}

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
    text,
  };
}

export function useChatSendMessage({
  agents,
  canSend,
  currentSessionId,
  ensureSession,
  inputValue,
  messages,
  modes,
  persistMessage,
  refreshSessions,
  resolveProviderSettings,
  setActivity,
  setInputValue,
  setIsLoading,
  setMessages,
  setOpenSelectedModeSignal,
  setResourceCost,
  setResourceToken,
  maxAgentSteps = DEFAULT_MAX_AGENT_STEPS,
}: SendMessageDeps) {
  const sendMessage = async (): Promise<void> => {
    if (!canSend) {
      return;
    }

    const text = inputValue.trim();
    if (!text) {
      return;
    }

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

    const mainAgent = agents.find((agent) => agent.role === "main") ?? agents[0];
    const typingMessage = buildTypingMessage(
      "Thinking...",
      mainAgent?.name,
      mainAgent?.icon,
      mainAgent?.color ? (AGENT_COLOR_VALUES[mainAgent.color] ?? "#86efac") : undefined
    );

    setMessages((prev) => [...prev, userMessage, typingMessage]);
    setInputValue("");
    setIsLoading(true);

    let activeSessionId = currentSessionId;
    let activeAssistantMessage: Message = typingMessage;

    try {
      const session = await ensureSession(text);
      activeSessionId = session.id;
      await persistMessage(session.id, userMessage);

      const sessionDetail = await getChatSession(session.id);
      const activeSettings = await resolveProviderSettings();

      if (!hasAvailableProvider()) {
        await publishGuardMessage({
          sessionId: session.id,
          typingMessage,
          text: "사용 가능한 모델이 없습니다. 우측 상단의 사용자 버튼을 눌러 Provider를 설정하세요.",
          setMessages,
          persistMessage,
          refreshSessions,
          modes,
        });
        return;
      }

      activeAssistantMessage = {
        ...typingMessage,
        id: `assistant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        type: "text",
        text: "",
      };

      moveMessageToBottom(setMessages, typingMessage.id, activeAssistantMessage);

      const response = await runMainAgentLoop({
        sessionId: session.id,
        projectPaths: sessionDetail.session.projectPaths || [],
        mainAgent,
        activeSettings,
        baseMessages: buildConversationMessages(sessionDetail.messages),
        setMessages,
        setActivity,
        persistMessage,
        activeAssistantMessageId: activeAssistantMessage.id,
        maxAgentSteps,
      });

      const assistantMessage = createAssistantMessage(activeAssistantMessage, response.text);
      replaceTypingMessage(setMessages, activeAssistantMessage.id, assistantMessage);

      await persistMessage(session.id, assistantMessage);
      await refreshSessions(modes, session.id);
      updateUsageMetrics(response.totalTokens, setResourceToken, setResourceCost);

      const usageText = response.totalTokens > 0 ? ` Tokens used: ${response.totalTokens}` : "";
      setActivity((prev) => [
        ...prev,
        buildActivity(
          `Agent response completed.${usageText}`.trim(),
          mainAgent?.name ?? "Assistant"
        ),
      ]);
    } catch (error) {
      const reason = getErrorMessage(error);
      const errorMessage: Message = {
        ...activeAssistantMessage,
        type: "text",
        text: `Request failed: ${reason}`,
      };
      replaceTypingMessage(setMessages, activeAssistantMessage.id, errorMessage);

      if (activeSessionId) {
        try {
          await persistMessage(activeSessionId, errorMessage);
          await refreshSessions(modes, activeSessionId);
        } catch {
          // 오류 메시지 저장 실패가 원래 응답보다 우선되지는 않도록 무시합니다.
        }
      }

      setActivity((prev) => [
        ...prev,
        buildActivity("LLM 응답을 받는 중 오류가 발생했습니다.", "System"),
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return { sendMessage };
}
