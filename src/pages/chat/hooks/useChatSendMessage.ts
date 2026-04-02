import { invoke } from "@tauri-apps/api/core";
import type { Dispatch, SetStateAction } from "react";

import {
  AGENT_COLOR_VALUES,
  appendChunkToMessage,
  buildActivity,
  buildLLMMessages,
  buildTypingMessage,
  nowTime,
} from "@/utils/chat";
import { sendToLLM } from "@/lib/llm";
import { composeAgentSystemPrompt, type Mode } from "@/data/appData";
import type {
  ActivityItem,
  AgentItem,
  Message,
  ResolvedLLMSettings,
  SessionDetail,
  SessionItem,
} from "@/types/chat";
import {
  getErrorMessage,
  normalizePriority,
  parseJsonObject,
  type DelegationTask,
  type SubagentExecutionResult,
} from "@/features/app/appHelpers";
import { executeRuntimePlan } from "@/features/runtime/runtimeOrchestrator";

type OrchestrationAction = "runtime" | "delegate" | "final";

type OrchestrationDecision = {
  action: OrchestrationAction;
  reasoning?: string;
  finalInstruction?: string;
  tasks?: DelegationTask[];
};

type OrchestrationNote = {
  kind: "runtime" | "delegation";
  title: string;
  content: string;
};

type SendMessageDeps = {
  agents: AgentItem[];
  canSend: boolean;
  currentSessionId: string | null;
  ensureSession: (text: string) => Promise<SessionItem>;
  inputValue: string;
  messages: Message[];
  modes: Mode[];
  persistMessage: (sessionId: string, message: Message) => Promise<void>;
  refreshSessions: (modes: Mode[], nextSessionId: string | null) => Promise<void>;
  resolveProviderSettings: () => Promise<ResolvedLLMSettings>;
  setActivity: Dispatch<SetStateAction<ActivityItem[]>>;
  setInputValue: Dispatch<SetStateAction<string>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setOpenSelectedModeSignal: Dispatch<SetStateAction<number>>;
  setResourceCost: Dispatch<SetStateAction<number>>;
  setResourceToken: Dispatch<SetStateAction<number>>;
};

const replaceTypingMessage = (
  setMessages: Dispatch<SetStateAction<Message[]>>,
  typingMessageId: string,
  nextMessage: Message
) => {
  setMessages((prev) => prev.map((entry) => (entry.id === typingMessageId ? nextMessage : entry)));
};

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

const appendRuntimeLogMessage = (
  setMessages: Dispatch<SetStateAction<Message[]>>,
  id: string,
  sender: string,
  text: string,
  logs: string[],
  icon = "integration_instructions",
  iconColor = "#7dd3fc"
) => {
  setMessages((prev) => [
    ...prev,
    {
      id,
      side: "agent",
      sender,
      byline: nowTime(),
      icon,
      iconColor,
      type: "search",
      text,
      logs,
    },
  ]);
};

const buildAgentCapabilitySummary = (agent: AgentItem) => {
  const parts = [
    `name: ${agent.name}`,
    `role: ${agent.role ?? "sub"}`,
    `model: ${agent.model || "default"}`,
    `prompt: ${agent.prompt?.trim() || "none"}`,
    `tools: ${agent.tools?.join(", ") || "none"}`,
    `mcp: ${agent.mcpServers?.join(", ") || "none"}`,
    `skills: ${agent.skills?.join(", ") || "none"}`,
  ];

  return parts.join("\n");
};

const buildOrchestrationNotesText = (notes: OrchestrationNote[]) => {
  if (notes.length === 0) {
    return "No internal notes yet.";
  }

  return notes
    .map((note, index) => [`[${index + 1}] ${note.kind}: ${note.title}`, note.content].join("\n"))
    .join("\n\n");
};

const buildWorkingRequestText = (text: string, notes: OrchestrationNote[]) => {
  if (notes.length === 0) {
    return text;
  }

  return [
    text,
    "",
    "Internal working notes gathered so far:",
    buildOrchestrationNotesText(notes),
  ].join("\n");
};

const decideMainAgentNextStep = async (
  text: string,
  requestMessages: ReturnType<typeof buildLLMMessages>,
  mainAgent: AgentItem,
  availableSubagents: AgentItem[],
  activeSettings: ResolvedLLMSettings,
  projectPaths: string[],
  notes: OrchestrationNote[],
  iteration: number,
  maxIterations: number
): Promise<OrchestrationDecision> => {
  const subagentText =
    availableSubagents.length > 0
      ? availableSubagents.map(buildAgentCapabilitySummary).join("\n\n")
      : "- none";
  const projectPathText = projectPaths.length > 0 ? projectPaths.join("\n") : "- none";

  const routingPrompt = [
    "You are the main orchestration agent.",
    "Choose exactly one next action for this iteration.",
    "Available actions:",
    '- "runtime": inspect the workspace or execute local runtime actions',
    '- "delegate": assign specialist work to one or more subagents',
    '- "final": stop iterating and prepare the final user-facing answer',
    "",
    "Rules:",
    "- Prefer runtime when codebase inspection, file reads, search, or shell execution is needed.",
    "- Prefer delegate when specialist parallel work is useful.",
    "- Prefer final when enough evidence has been gathered.",
    "- Return strict JSON only.",
    "",
    "Schema:",
    '{"action":"runtime|delegate|final","reasoning":"string","finalInstruction":"string optional","tasks":[{"agentName":"string","goal":"string","deliverable":"string","priority":"high|medium|low"}]}',
    "",
    `Iteration: ${iteration + 1}/${maxIterations}`,
    `Project paths:\n${projectPathText}`,
    "",
    "Available subagents:",
    subagentText,
    "",
    "Internal notes gathered so far:",
    buildOrchestrationNotesText(notes),
    "",
    `Latest user request:\n${text}`,
  ].join("\n");

  const routingResponse = await sendToLLM({
    providerId: activeSettings.providerId,
    providerKind: activeSettings.providerKind,
    apiBaseUrl: activeSettings.baseUrl,
    apiKey: activeSettings.apiKey,
    accessToken: activeSettings.accessToken,
    accountId: activeSettings.accountId,
    model: mainAgent.model?.trim() || activeSettings.model,
    messages: [
      {
        role: "system",
        content: composeAgentSystemPrompt(
          mainAgent.model?.trim() || activeSettings.model,
          mainAgent.prompt,
          "You are deciding the next orchestration action. Return JSON only."
        ),
      },
      ...requestMessages.slice(1),
      {
        role: "user",
        content: routingPrompt,
      },
    ],
    stream: false,
  });

  const parsed = parseJsonObject<OrchestrationDecision>(routingResponse.text);
  if (!parsed) {
    return {
      action: "final",
      reasoning: "Failed to parse orchestration decision JSON.",
    };
  }

  const allowedNames = new Set(availableSubagents.map((agent) => agent.name));
  const normalizedTasks = Array.isArray(parsed.tasks)
    ? parsed.tasks
        .filter((task) => task && allowedNames.has(task.agentName))
        .map((task) => ({
          agentName: task.agentName,
          goal: task.goal?.trim() || text,
          deliverable: task.deliverable?.trim() || "Provide specialist findings.",
          priority: normalizePriority(task.priority),
        }))
    : [];

  const action: OrchestrationAction =
    parsed.action === "runtime" || parsed.action === "delegate" || parsed.action === "final"
      ? parsed.action
      : "final";

  if (action === "delegate" && normalizedTasks.length === 0) {
    return {
      action: "final",
      reasoning: parsed.reasoning || "No valid subagent tasks were provided.",
      finalInstruction: parsed.finalInstruction,
    };
  }

  if (action === "runtime" && projectPaths.length === 0) {
    return {
      action: "final",
      reasoning: parsed.reasoning || "Runtime was requested without a project path.",
      finalInstruction: parsed.finalInstruction,
    };
  }

  return {
    action,
    reasoning: parsed.reasoning,
    finalInstruction: parsed.finalInstruction,
    tasks: normalizedTasks,
  };
};

const runDelegatedSubagents = async (
  text: string,
  selectedTasks: DelegationTask[],
  availableSubagents: AgentItem[],
  requestMessages: ReturnType<typeof buildLLMMessages>,
  activeSettings: ResolvedLLMSettings,
  notes: OrchestrationNote[],
  setActivity: Dispatch<SetStateAction<ActivityItem[]>>,
  onStatus?: (statusText: string) => void
): Promise<SubagentExecutionResult[]> => {
  const subagentsByName = new Map(availableSubagents.map((agent) => [agent.name, agent]));

  return Promise.all(
    selectedTasks.map(async (task) => {
      const agent = subagentsByName.get(task.agentName);
      if (!agent) {
        return {
          agentName: task.agentName,
          status: "failed" as const,
          summary: "Agent is unavailable.",
          deliverable: task.deliverable,
          priority: normalizePriority(task.priority),
        };
      }

      setActivity((prev) => [...prev, buildActivity(`${agent.name} assigned: ${task.goal}`, agent.name)]);
      onStatus?.(`Delegating to ${agent.name}: ${task.goal}`);

      const subagentPrompt = [
        "You are a specialist subagent working for the main orchestration agent.",
        "Complete only your assigned portion of the work.",
        "Do not address the end user directly.",
        "Return concise, high-signal findings for the main agent to synthesize.",
        `Assigned goal: ${task.goal}`,
        `Required deliverable: ${task.deliverable}`,
        "",
        "Existing internal notes from prior iterations:",
        buildOrchestrationNotesText(notes),
        "",
        "Recent conversation context:",
        requestMessages
          .slice(1)
          .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
          .join("\n\n"),
        "",
        `Original latest user request:\n${text}`,
      ].join("\n");

      try {
        const response = await sendToLLM({
          providerId: activeSettings.providerId,
          providerKind: activeSettings.providerKind,
          apiBaseUrl: activeSettings.baseUrl,
          apiKey: activeSettings.apiKey,
          accessToken: activeSettings.accessToken,
          accountId: activeSettings.accountId,
          model: agent.model?.trim() || activeSettings.model,
          messages: [
            {
              role: "system",
              content: composeAgentSystemPrompt(
                agent.model?.trim() || activeSettings.model,
                agent.prompt,
                "You are a delegated specialist subagent. Return only your work product."
              ),
            },
            {
              role: "user",
              content: subagentPrompt,
            },
          ],
          stream: false,
        });

        setActivity((prev) => [...prev, buildActivity(`${agent.name} completed delegated work.`, agent.name)]);
        onStatus?.(`${agent.name} finished. Synthesizing specialist results...`);

        return {
          agentName: agent.name,
          status: "completed" as const,
          summary: response.text.trim() || "Completed with no textual output.",
          deliverable: task.deliverable,
          priority: normalizePriority(task.priority),
        };
      } catch (error) {
        const reason = getErrorMessage(error);
        setActivity((prev) => [
          ...prev,
          buildActivity(`${agent.name} failed delegated work: ${reason}`, agent.name),
        ]);
        onStatus?.(`${agent.name} failed: ${reason}`);

        return {
          agentName: agent.name,
          status: "failed" as const,
          summary: reason,
          deliverable: task.deliverable,
          priority: normalizePriority(task.priority),
        };
      }
    })
  );
};

const generateMainAgentResponse = async (
  setMessages: Dispatch<SetStateAction<Message[]>>,
  typingMessageId: string,
  requestMessages: ReturnType<typeof buildLLMMessages>,
  mainAgent: AgentItem,
  activeSettings: ResolvedLLMSettings
) => {
  let streamedText = "";
  const response = await sendToLLM({
    providerId: activeSettings.providerId,
    providerKind: activeSettings.providerKind,
    apiBaseUrl: activeSettings.baseUrl,
    apiKey: activeSettings.apiKey,
    accessToken: activeSettings.accessToken,
    accountId: activeSettings.accountId,
    model:
      activeSettings.providerKind === "chatgpt_oauth"
        ? activeSettings.model
        : mainAgent.model?.trim() || activeSettings.model,
    messages: requestMessages,
    stream: true,
    onChunk: (chunk) => {
      streamedText += chunk;
      setMessages((prev) => appendChunkToMessage(prev, typingMessageId, streamedText));
    },
  });

  return {
    text: response.text || streamedText || "(응답이 비어 있습니다.)",
    usage: response.usage,
  };
};

const synthesizeMainAgentResponse = async (
  setMessages: Dispatch<SetStateAction<Message[]>>,
  text: string,
  typingMessageId: string,
  requestMessages: ReturnType<typeof buildLLMMessages>,
  mainAgent: AgentItem,
  activeSettings: ResolvedLLMSettings,
  notes: OrchestrationNote[],
  finalInstruction?: string
) => {
  if (notes.length === 0 && !finalInstruction?.trim()) {
    return generateMainAgentResponse(
      setMessages,
      typingMessageId,
      requestMessages,
      mainAgent,
      activeSettings
    );
  }

  let streamedText = "";
  const synthesisInput = [
    "You are the main agent responding to the user.",
    "The following internal orchestration notes are not user-facing.",
    "Use them as working context and produce the final answer.",
    finalInstruction?.trim() ? `Final instruction:\n${finalInstruction.trim()}` : null,
    "",
    `Latest user request:\n${text}`,
    "",
    "Internal notes:",
    buildOrchestrationNotesText(notes),
  ]
    .filter((value) => value !== null)
    .join("\n");

  const response = await sendToLLM({
    providerId: activeSettings.providerId,
    providerKind: activeSettings.providerKind,
    apiBaseUrl: activeSettings.baseUrl,
    apiKey: activeSettings.apiKey,
    accessToken: activeSettings.accessToken,
    accountId: activeSettings.accountId,
    model:
      activeSettings.providerKind === "chatgpt_oauth"
        ? activeSettings.model
        : mainAgent.model?.trim() || activeSettings.model,
    messages: [
      {
        role: "system",
        content: composeAgentSystemPrompt(
          mainAgent.model?.trim() || activeSettings.model,
          mainAgent.prompt,
          "You are synthesizing internal orchestration notes into a final user-facing answer."
        ),
      },
      ...requestMessages.slice(1),
      {
        role: "user",
        content: synthesisInput,
      },
    ],
    stream: true,
    onChunk: (chunk) => {
      streamedText += chunk;
      setMessages((prev) => appendChunkToMessage(prev, typingMessageId, streamedText));
    },
  });

  return {
    text: response.text || streamedText || "(응답이 비어 있습니다.)",
    usage: response.usage,
  };
};

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
    let activeAssistantMessage = typingMessage;

    setMessages((prev) => [...prev, userMessage, typingMessage]);
    setInputValue("");
    setIsLoading(true);

    let activeSessionId = currentSessionId;

    try {
      const session = await ensureSession(text);
      activeSessionId = session.id;
      await persistMessage(session.id, userMessage);

      const sessionDetail = await invoke<SessionDetail>("get_chat_session", {
        sessionId: session.id,
      });
      updateStreamingStatusMessage(setMessages, typingMessage.id, "생각 중...");
      const activeSettings = await resolveProviderSettings();
      const resolvedMainModel =
        activeSettings.providerKind === "chatgpt_oauth"
          ? activeSettings.model
          : mainAgent?.model?.trim() || activeSettings.model;
      const requestMessages = buildLLMMessages(
        sessionDetail.messages,
        mainAgent?.prompt ?? undefined,
        resolvedMainModel
      );
      const projectPaths = sessionDetail.session.projectPaths || [];
      const activeAgents = agents.filter((agent) => agent.active);
      const availableSubagents = activeAgents.filter(
        (agent) => agent.role !== "main" && agent.name !== mainAgent?.name
      );

      if (activeSettings.providerKind === "chatgpt_oauth" && !activeSettings.accessToken) {
        const loginMessage: Message = {
          ...typingMessage,
          type: "text",
          text: "ChatGPT 로그인이 필요합니다. Provider 메뉴에서 로그인한 뒤 다시 시도해 주세요.",
        };
        replaceTypingMessage(setMessages, typingMessage.id, loginMessage);
        await persistMessage(session.id, loginMessage);
        await refreshSessions(modes, session.id);
        return;
      }

      if (activeSettings.providerKind !== "chatgpt_oauth" && !activeSettings.apiKey) {
        const missingApiKeyMessage: Message = {
          ...typingMessage,
          type: "text",
          text: "API 키가 설정되지 않았습니다. Provider 설정에서 키를 추가해 주세요.",
        };
        replaceTypingMessage(setMessages, typingMessage.id, missingApiKeyMessage);
        await persistMessage(session.id, missingApiKeyMessage);
        await refreshSessions(modes, session.id);
        setActivity((prev) => [
          ...prev,
          buildActivity(
            "API 키가 없어 LLM 요청을 시작하지 못했습니다.",
            mainAgent?.name ?? "Assistant"
          ),
        ]);
        return;
      }

      let response: { text: string; usage?: { totalTokens?: number } };
      const orchestrationNotes: OrchestrationNote[] = [];
      const maxOrchestrationIterations = 4;

      while (true) {
        const orchestrationDecision = await decideMainAgentNextStep(
          text,
          requestMessages,
          mainAgent,
          availableSubagents,
          activeSettings,
          projectPaths,
          orchestrationNotes,
          orchestrationNotes.length,
          maxOrchestrationIterations
        );

        const shouldContinue =
          orchestrationDecision.action !== "final" &&
          orchestrationNotes.length < maxOrchestrationIterations - 1;

        if (orchestrationDecision.action === "runtime" && shouldContinue) {
          updateStreamingStatusMessage(setMessages, typingMessage.id, "Running runtime investigation...");
          const runtimeResult = await executeRuntimePlan({
            text: buildWorkingRequestText(text, orchestrationNotes),
            mainAgent,
            requestMessages,
            activeSettings,
            projectPaths,
            onStatus: (statusText) =>
              updateStreamingStatusMessage(setMessages, typingMessage.id, statusText),
          });

          if (!runtimeResult) {
            orchestrationNotes.push({
              kind: "runtime",
              title: "Runtime planner skipped execution",
              content: orchestrationDecision.reasoning || "Runtime produced no executable plan.",
            });
          } else {
            const runtimeMessageId = `runtime-${Date.now().toString(36)}-${Math.random()
              .toString(36)
              .slice(2, 6)}`;
            const runtimeMessage: Message = {
              id: runtimeMessageId,
              side: "agent",
              sender: `${mainAgent?.name ?? "Assistant"} Runtime`,
              byline: nowTime(),
              icon: "integration_instructions",
              iconColor: "#7dd3fc",
              type: "search",
              text: "Runtime actions executed.",
              logs: runtimeResult.logs,
            };

            appendRuntimeLogMessage(
              setMessages,
              runtimeMessageId,
              runtimeMessage.sender ?? "Assistant Runtime",
              runtimeMessage.text ?? "Runtime actions executed.",
              runtimeResult.logs,
              runtimeMessage.icon,
              runtimeMessage.iconColor
            );
            await persistMessage(session.id, runtimeMessage);

            orchestrationNotes.push({
              kind: "runtime",
              title: runtimeResult.plan.summary?.trim() || "Runtime execution",
              content: [
                orchestrationDecision.reasoning
                  ? `Decision reasoning: ${orchestrationDecision.reasoning}`
                  : null,
                "Logs:",
                runtimeResult.logs.join("\n") || "No logs.",
                "",
                "Artifacts:",
                runtimeResult.artifacts
                  .map((artifact) => `[${artifact.kind}] ${artifact.title}\n${artifact.content}`)
                  .join("\n\n") || "No artifacts.",
              ]
                .filter((value) => value !== null)
                .join("\n"),
            });
          }

          continue;
        }

        if (
          orchestrationDecision.action === "delegate" &&
          shouldContinue &&
          Array.isArray(orchestrationDecision.tasks) &&
          orchestrationDecision.tasks.length > 0
        ) {
          updateStreamingStatusMessage(
            setMessages,
            typingMessage.id,
            `Planning parallel work for ${orchestrationDecision.tasks.length} specialist agent(s)...`
          );
          setActivity((prev) => [
            ...prev,
            buildActivity(
              `${mainAgent?.name ?? "Main agent"} delegated ${orchestrationDecision.tasks.length} task(s).`,
              mainAgent?.name ?? "Main agent"
            ),
          ]);

          const subagentResults = await runDelegatedSubagents(
            text,
            orchestrationDecision.tasks,
            availableSubagents,
            requestMessages,
            activeSettings,
            orchestrationNotes,
            setActivity,
            (statusText) => updateStreamingStatusMessage(setMessages, typingMessage.id, statusText)
          );

          orchestrationNotes.push({
            kind: "delegation",
            title: orchestrationDecision.reasoning?.trim() || "Delegated specialist work",
            content: subagentResults
              .map((result) =>
                [
                  `Agent: ${result.agentName}`,
                  `Status: ${result.status}`,
                  `Priority: ${result.priority}`,
                  `Deliverable: ${result.deliverable}`,
                  `Output:\n${result.summary}`,
                ].join("\n")
              )
              .join("\n\n"),
          });

          continue;
        }

        updateStreamingStatusMessage(setMessages, typingMessage.id, "Streaming response...");
        activeAssistantMessage = {
          ...typingMessage,
          id: `assistant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          type: "text",
          text: "",
        };
        moveMessageToBottom(setMessages, typingMessage.id, activeAssistantMessage);
        response = await synthesizeMainAgentResponse(
          setMessages,
          text,
          activeAssistantMessage.id,
          requestMessages,
          mainAgent,
          activeSettings,
          orchestrationNotes,
          orchestrationDecision.finalInstruction
        );
        break;
      }

      const assistantMessage: Message = {
        ...activeAssistantMessage,
        type: "text",
        text: response.text,
      };

      replaceTypingMessage(setMessages, activeAssistantMessage.id, assistantMessage);
      await persistMessage(session.id, assistantMessage);
      await refreshSessions(modes, session.id);

      const totalTokens = response.usage?.totalTokens;
      if (typeof totalTokens === "number") {
        setResourceToken((prev) => Math.min(9999, prev + totalTokens));
      }

      const estimatedCost = response.usage?.totalTokens ? response.usage.totalTokens * 0.000005 : 0;
      if (estimatedCost > 0) {
        setResourceCost((prev) => Number((prev + estimatedCost).toFixed(3)));
      }

      const usageText = response.usage?.totalTokens
        ? ` Tokens used: ${response.usage.totalTokens}`
        : "";
      setActivity((prev) => [
        ...prev,
        buildActivity(`Agent response completed.${usageText}`.trim(), mainAgent?.name ?? "Assistant"),
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
          // 에러 메시지 저장이 실패해도 사용자 응답은 막지 않도록 무시한다.
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
