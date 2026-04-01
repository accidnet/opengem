import { useEffect, useMemo, useState, type KeyboardEvent, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";

import { sendToLLM } from "../lib/llm";
import {
  AGENTS,
  DEFAULT_MODE_ICONS,
  INITIAL_ACTIVITY,
  LLM_CONFIG,
  MODE_ICON_OPTIONS,
  MODES,
  SESSION_MESSAGES,
  composeAgentSystemPrompt,
  type Mode,
  type ModeIcon,
} from "../data/appData";
import { normalizeLlmSettings } from "../data/llmCatalog";
import {
  AGENT_COLOR_VALUES,
  appendChunkToMessage,
  buildActivity,
  buildLLMMessages,
  buildSessionTitle,
  buildTypingMessage,
  nowTime,
} from "../utils/chat";
import type {
  ActivityItem,
  AgentItem,
  LLMSettings,
  Message,
  OperationModeState,
  ResolvedLLMSettings,
  SessionDetail,
  SessionItem,
  ThemeMode,
} from "../types/chat";
import {
  getErrorMessage,
  normalizeAgentsForUi,
  normalizePriority,
  parseJsonObject,
  type DelegationTask,
  type OperationModeInput,
  type PersistedAgent,
  type StartChatgptLoginPayload,
  type SubagentExecutionResult,
} from "../features/app/appHelpers";
import {
  executeRuntimePlan,
} from "../features/runtime/runtimeOrchestrator";

async function openExternalUrl(url: string): Promise<void> {
  await invoke("open_external_url", { url });
}

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

export function useAppController() {
  const [messages, setMessages] = useState<Message[]>(SESSION_MESSAGES);
  const [sessionsByMode, setSessionsByMode] = useState<Record<Mode, SessionItem[]>>({});
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSessionTitle, setCurrentSessionTitle] = useState("새 채팅");
  const [currentSessionProjectPaths, setCurrentSessionProjectPaths] = useState<string[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>(INITIAL_ACTIVITY);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [modes, setModes] = useState<Mode[]>([...MODES]);
  const [selectedMode, setSelectedMode] = useState<Mode>(MODES[0]);
  const [modeIcons, setModeIcons] = useState<Record<Mode, ModeIcon>>({ ...DEFAULT_MODE_ICONS });
  const [modeProjectPaths, setModeProjectPaths] = useState<Record<Mode, string[]>>({});
  const [modeDefaultModels, setModeDefaultModels] = useState<Record<Mode, string>>({});
  const [resourceToken, setResourceToken] = useState(2405);
  const [resourceCost, setResourceCost] = useState(0.04);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [agents, setAgents] = useState<AgentItem[]>(normalizeAgentsForUi([...AGENTS]));
  const [settings, setSettings] = useState<LLMSettings>(LLM_CONFIG);
  const [isPanelModalOpen, setIsPanelModalOpen] = useState(false);
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [isChatGPTLoginBusy, setIsChatGPTLoginBusy] = useState(false);
  const [chatGPTLoginUrl, setChatGPTLoginUrl] = useState("");
  const [panelModalError, setPanelModalError] = useState("");
  const [openSelectedModeSignal, setOpenSelectedModeSignal] = useState(0);

  useEffect(() => {
    void loadOperationModes();
    void loadProviderSettings();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const timer = setInterval(() => {
      setResourceToken((value) => Math.min(9999, value + 9));
      setResourceCost((value) => Number((value + 0.001).toFixed(3)));
    }, 6500);

    return () => clearInterval(timer);
  }, []);

  const canSend = inputValue.trim().length > 0 && !isLoading && !isSessionLoading;

  const tokenPercent = useMemo(() => {
    return Math.max(5, Math.min(90, Math.round((resourceToken / 12000) * 100)));
  }, [resourceToken]);

  const costPercent = useMemo(() => {
    return Math.max(10, Math.min(65, Math.round((resourceCost / 0.35) * 100)));
  }, [resourceCost]);

  const loadProviderSettings = async () => {
    try {
      const next = await invoke<LLMSettings>("get_llm_settings");
      setSettings(normalizeLlmSettings(next));
      setPanelModalError("");
    } catch {
      setSettings(normalizeLlmSettings(LLM_CONFIG));
    }
  };

  const applySessionList = (
    nextSessions: SessionItem[],
    nextModes: ReadonlyArray<Mode>,
    activeSessionId?: string | null
  ) => {
    const resolvedActiveSessionId =
      activeSessionId === undefined ? currentSessionId : activeSessionId;
    const grouped = nextModes.reduce<Record<Mode, SessionItem[]>>(
      (acc, mode) => {
        acc[mode] = [];
        return acc;
      },
      {} as Record<Mode, SessionItem[]>
    );

    nextSessions.forEach((session) => {
      const normalizedSession = {
        ...session,
        active: session.id === resolvedActiveSessionId,
      };

      if (!grouped[session.modeName]) {
        grouped[session.modeName] = [];
      }

      grouped[session.modeName].push(normalizedSession);
    });

    setSessionsByMode(grouped);
  };

  const refreshSessions = async (
    nextModes: ReadonlyArray<Mode>,
    activeSessionId?: string | null
  ) => {
    const nextSessions = await invoke<SessionItem[]>("list_chat_sessions");
    applySessionList(nextSessions, nextModes, activeSessionId);
    return nextSessions;
  };

  const resetCurrentSession = () => {
    setMessages(SESSION_MESSAGES);
    setCurrentSessionId(null);
    setCurrentSessionTitle("새 채팅");
    setCurrentSessionProjectPaths([]);
    setInputValue("");
  };

  const loadSession = async (sessionId: string, nextModes: ReadonlyArray<Mode> = modes) => {
    setIsSessionLoading(true);
    try {
      const detail = await invoke<SessionDetail>("get_chat_session", { sessionId });
      setCurrentSessionId(detail.session.id);
      setCurrentSessionTitle(detail.session.title);
      setCurrentSessionProjectPaths(detail.session.projectPaths || []);
      setMessages(detail.messages);
      await refreshSessions(nextModes, detail.session.id);
    } finally {
      setIsSessionLoading(false);
    }
  };

  const syncModeSessions = async (
    mode: Mode,
    nextModes: ReadonlyArray<Mode>,
    preferredSessionId?: string | null
  ) => {
    const nextSessions = await refreshSessions(nextModes, preferredSessionId);
    const modeSessions = nextSessions.filter((session) => session.modeName === mode);
    const candidateSessionId =
      preferredSessionId && modeSessions.some((session) => session.id === preferredSessionId)
        ? preferredSessionId
        : modeSessions[0]?.id;

    if (!candidateSessionId) {
      resetCurrentSession();
      return;
    }

    if (candidateSessionId === currentSessionId) {
      await refreshSessions(nextModes, candidateSessionId);
      return;
    }

    await loadSession(candidateSessionId, nextModes);
  };

  const loadOperationModes = async () => {
    try {
      const next = await invoke<OperationModeState>("load_operation_mode");
      if (next.modes.length === 0) {
        return;
      }

      setModes(next.modes);
      setSelectedMode(next.selectedMode);
      setModeProjectPaths(
        next.items.reduce<Record<Mode, string[]>>((acc, item) => {
          acc[item.name] = item.projectPaths || [];
          return acc;
        }, {})
      );
      setModeDefaultModels(
        next.items.reduce<Record<Mode, string>>((acc, item) => {
          acc[item.name] = item.defaultModel?.trim() || LLM_CONFIG.model;
          return acc;
        }, {})
      );

      try {
        const nextAgents = await invoke<PersistedAgent[]>("load_mode_agents", {
          modeName: next.selectedMode,
        });
        setAgents(normalizeAgentsForUi(nextAgents));
      } catch {
        setAgents(normalizeAgentsForUi([...AGENTS]));
      }

      setModeIcons((prev) => {
        const nextIcons = { ...prev };
        next.modes.forEach((mode, index) => {
          if (!nextIcons[mode]) {
            nextIcons[mode] = index === 0 ? "smart_toy" : "tune";
          }
        });
        return nextIcons;
      });

      await syncModeSessions(next.selectedMode, next.modes, null);
    } catch {
      setModes([...MODES]);
      setSelectedMode(MODES[0]);
      setModeProjectPaths({});
      setModeDefaultModels({});
      setAgents(normalizeAgentsForUi([...AGENTS]));
      setSessionsByMode({});
    }
  };

  const persistOperationModes = async (nextModes: OperationModeInput[], nextSelectedMode: Mode) => {
    await invoke("save_operation_mode", {
      modes: nextModes,
      selectedMode: nextSelectedMode,
    });
  };

  const loadAgentsForMode = async (mode: Mode) => {
    try {
      const nextAgents = await invoke<PersistedAgent[]>("load_mode_agents", {
        modeName: mode,
      });
      setAgents(normalizeAgentsForUi(nextAgents));
    } catch {
      setAgents(normalizeAgentsForUi([...AGENTS]));
    }
  };

  const selectOperationMode = async (mode: Mode) => {
    const previousMode = selectedMode;
    const previousAgents = agents;
    setSelectedMode(mode);

    try {
      await invoke("select_operation_mode", { selectedMode: mode });
      await loadAgentsForMode(mode);
      await syncModeSessions(mode, modes, null);
    } catch {
      setSelectedMode(previousMode);
      setAgents(previousAgents);
    }
  };

  const resolveProviderSettings = async (): Promise<ResolvedLLMSettings> => {
    try {
      const next = await invoke<ResolvedLLMSettings>("resolve_llm_settings");
      return {
        ...normalizeLlmSettings(next),
        accessToken: next.accessToken,
        accountId: next.accountId,
      };
    } catch {
      return normalizeLlmSettings(settings);
    }
  };

  const persistMessage = async (sessionId: string, message: Message) => {
    await invoke("append_chat_message", {
      input: {
        sessionId,
        message,
      },
    });
  };

  const ensureSession = async (text: string) => {
    if (currentSessionId) {
      return {
        id: currentSessionId,
        title: currentSessionTitle,
        projectPaths: currentSessionProjectPaths,
      };
    }

    const created = await invoke<SessionItem>("create_chat_session", {
      input: {
        title: buildSessionTitle(text),
        modeName: selectedMode,
      },
    });

    setCurrentSessionId(created.id);
    setCurrentSessionTitle(created.title);
    setCurrentSessionProjectPaths(created.projectPaths || []);
    await refreshSessions(modes, created.id);

    return created;
  };

  const replaceTypingMessage = (typingMessageId: string, nextMessage: Message) => {
    setMessages((prev) =>
      prev.map((entry) => (entry.id === typingMessageId ? nextMessage : entry))
    );
  };

  const updateStreamingStatusMessage = (
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

  const synthesizeDelegatedResponse = async (
    text: string,
    typingMessageId: string,
    mainAgent: AgentItem,
    requestMessages: ReturnType<typeof buildLLMMessages>,
    delegationReasoning: string | undefined,
    subagentResults: SubagentExecutionResult[],
    activeSettings: ResolvedLLMSettings
  ) => {
    let streamedText = "";
    const synthesisInput = [
      "You are the main agent responding to the user.",
      "The following subagent outputs are internal notes.",
      "Synthesize them into one coherent final answer.",
      "",
      `Latest user request:\n${text}`,
      "",
      `Routing reasoning:\n${delegationReasoning || "No reasoning provided."}`,
      "",
      "Subagent results:",
      subagentResults
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
    ].join("\n");

    const response = await sendToLLM({
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
            "You are synthesizing delegated specialist work into a final user-facing answer."
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

  void synthesizeDelegatedResponse;

  const generateMainAgentResponse = async (
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
    text: string,
    typingMessageId: string,
    requestMessages: ReturnType<typeof buildLLMMessages>,
    mainAgent: AgentItem,
    activeSettings: ResolvedLLMSettings,
    notes: OrchestrationNote[],
    finalInstruction?: string
  ) => {
    if (notes.length === 0 && !finalInstruction?.trim()) {
      return generateMainAgentResponse(typingMessageId, requestMessages, mainAgent, activeSettings);
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

    const mainAgent = agents.find((a) => a.role === "main") ?? agents[0];
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

    try {
      const session = await ensureSession(text);
      activeSessionId = session.id;
      await persistMessage(session.id, userMessage);

      const sessionDetail = await invoke<SessionDetail>("get_chat_session", {
        sessionId: session.id,
      });
      updateStreamingStatusMessage(typingMessage.id, "생각 중...");
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
          text: "ChatGPT 로그인이 필요합니다. Provider 메뉴에서 로그인 후 다시 시도해 주세요.",
        };
        replaceTypingMessage(typingMessage.id, loginMessage);
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
        replaceTypingMessage(typingMessage.id, missingApiKeyMessage);
        await persistMessage(session.id, missingApiKeyMessage);
        await refreshSessions(modes, session.id);
        setActivity((prev) => [
          ...prev,
          buildActivity(
            "API 키가 없어 LLM 요청을 시작할 수 없었습니다.",
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
          updateStreamingStatusMessage(typingMessage.id, "Running runtime investigation...");
          const runtimeResult = await executeRuntimePlan({
            text: buildWorkingRequestText(text, orchestrationNotes),
            mainAgent,
            requestMessages,
            activeSettings,
            projectPaths,
            onStatus: (statusText) => updateStreamingStatusMessage(typingMessage.id, statusText),
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
            (statusText) => updateStreamingStatusMessage(typingMessage.id, statusText)
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

        updateStreamingStatusMessage(typingMessage.id, "Streaming response...");
        response = await synthesizeMainAgentResponse(
          text,
          typingMessage.id,
          requestMessages,
          mainAgent,
          activeSettings,
          orchestrationNotes,
          orchestrationDecision.finalInstruction
        );
        break;
      }

      const assistantMessage: Message = {
        ...typingMessage,
        type: "text",
        text: response.text,
      };

      replaceTypingMessage(typingMessage.id, assistantMessage);
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
        ...typingMessage,
        type: "text",
        text: `Request failed: ${reason}`,
      };
      replaceTypingMessage(typingMessage.id, errorMessage);

      if (activeSessionId) {
        try {
          await persistMessage(activeSessionId, errorMessage);
          await refreshSessions(modes, activeSessionId);
        } catch {
          // 에러 메시지 저장 실패는 사용자 응답을 막지 않도록 무시한다.
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

  const appendStatusMessage = (text: string): void => {
    setMessages((prev) => [
      ...prev,
      {
        id: `status-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        side: "status",
        type: "status",
        statusText: text,
      },
    ]);
  };

  const appendRuntimeLogMessage = (
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

  const handleApprovePlan = () => {
    appendStatusMessage("계획이 승인되어 다음 단계를 진행합니다.");
  };

  const handleModifyPlan = () => {
    setInputValue("계획에서 수정하거나 보완할 내용을 정리해 주세요.");
    appendStatusMessage("계획 수정 요청을 남겼습니다.");
  };

  const clearContext = () => {
    resetCurrentSession();
    setActivity([...INITIAL_ACTIVITY]);
    void refreshSessions(modes, null);
  };

  const startNewChat = () => {
    resetCurrentSession();
    setActivity([...INITIAL_ACTIVITY]);
    void refreshSessions(modes, null);
  };

  const handleSessionSelect = async (session: SessionItem) => {
    if (session.id === currentSessionId) {
      return;
    }

    try {
      if (session.modeName !== selectedMode) {
        setSelectedMode(session.modeName);
        await invoke("select_operation_mode", { selectedMode: session.modeName });
        await loadAgentsForMode(session.modeName);
      }

      await loadSession(session.id, modes);
    } catch {
      // 세션 선택 실패는 현재 화면을 유지한다.
    }
  };

  const handleSessionDelete = async (session: SessionItem) => {
    try {
      await invoke("delete_chat_session", { sessionId: session.id });

      const nextSessions = await refreshSessions(modes, null);
      if (session.id !== currentSessionId) {
        return;
      }

      const sameModeSessions = nextSessions.filter((item) => item.modeName === session.modeName);
      const fallbackSession = sameModeSessions[0];

      if (!fallbackSession) {
        resetCurrentSession();
        if (session.modeName !== selectedMode) {
          setSelectedMode(session.modeName);
          await loadAgentsForMode(session.modeName);
        }
        return;
      }

      if (session.modeName !== selectedMode) {
        setSelectedMode(session.modeName);
        await invoke("select_operation_mode", { selectedMode: session.modeName });
        await loadAgentsForMode(session.modeName);
      }

      await loadSession(fallbackSession.id, modes);
    } catch {
      // 세션 삭제 실패 시 현재 상태를 유지한다.
    }
  };

  const saveOperationModeSettings = async (
    nextModes: Mode[],
    nextModeIcons: Record<Mode, ModeIcon>,
    nextSelectedMode: Mode,
    modeItems: OperationModeInput[]
  ) => {
    const previousModes = modes;
    const previousModeIcons = modeIcons;
    const previousModeProjectPaths = modeProjectPaths;
    const previousModeDefaultModels = modeDefaultModels;
    const previousSelectedMode = selectedMode;
    const previousAgents = agents;
    const nextModeProjectPaths = modeItems.reduce<Record<Mode, string[]>>((acc, mode) => {
      acc[mode.name] = mode.projectPaths || [];
      return acc;
    }, {});
    const nextModeDefaultModels = modeItems.reduce<Record<Mode, string>>((acc, mode) => {
      acc[mode.name] = mode.defaultModel?.trim() || LLM_CONFIG.model;
      return acc;
    }, {});

    setModes(nextModes);
    setModeIcons(nextModeIcons);
    setModeProjectPaths(nextModeProjectPaths);
    setModeDefaultModels(nextModeDefaultModels);
    setSelectedMode(nextSelectedMode);

    try {
      await persistOperationModes(modeItems, nextSelectedMode);
      await loadAgentsForMode(nextSelectedMode);
      await syncModeSessions(nextSelectedMode, nextModes, null);
    } catch {
      setModes(previousModes);
      setModeIcons(previousModeIcons);
      setModeProjectPaths(previousModeProjectPaths);
      setModeDefaultModels(previousModeDefaultModels);
      setSelectedMode(previousSelectedMode);
      setAgents(previousAgents);
      void loadOperationModes();
    }
  };

  const getModeIcon = (mode: Mode): ModeIcon => {
    return modeIcons[mode] || MODE_ICON_OPTIONS[2];
  };

  const getModeProjectPaths = (mode: Mode) => {
    return modeProjectPaths[mode] || [];
  };

  const getModeDefaultModel = (mode: Mode) => {
    return modeDefaultModels[mode] || settings.model || LLM_CONFIG.model;
  };

  const updateCurrentSessionProjectPaths = async (projectPaths: string[]) => {
    if (!currentSessionId) {
      return;
    }

    const next = await invoke<SessionItem>("update_chat_session_project_paths", {
      input: {
        sessionId: currentSessionId,
        projectPaths,
      },
    });

    setCurrentSessionProjectPaths(next.projectPaths || []);
    await refreshSessions(modes, currentSessionId);
  };

  const openProjectFolder = async (path: string) => {
    await invoke("open_folder_in_explorer", { path });
  };

  const saveAgentsForSelectedMode = async (nextAgents: AgentItem[]) => {
    const previousAgents = agents;
    const normalizedAgents = normalizeAgentsForUi(
      nextAgents.map(({ status: _status, ...agent }) => {
        void _status;
        return {
          ...agent,
        };
      })
    );

    setAgents(normalizedAgents);

    try {
      await invoke("save_mode_agents", {
        modeName: selectedMode,
        agents: normalizedAgents.map(({ status: _status, ...agent }) => {
          void _status;
          return agent;
        }),
      });
    } catch {
      setAgents(previousAgents);
      throw new Error("에이전트 설정을 저장하지 못했습니다.");
    }
  };

  const exportChat = async () => {
    const text = messages
      .map((item) => {
        if (item.side === "status") {
          return `[status] ${item.statusText}`;
        }

        return `${item.sender} ${item.byline || ""}\n${item.text || ""}`;
      })
      .join("\n\n");

    if (!navigator?.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(text);
  };

  const onEnterSubmit = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const savePanelModalSettings = async () => {
    setIsSavingProvider(true);
    try {
      const next = await invoke<LLMSettings>("save_llm_settings", { input: settings });
      setSettings(normalizeLlmSettings(next));
      setPanelModalError("");
      setIsPanelModalOpen(false);
    } catch (error) {
      setPanelModalError(error instanceof Error ? error.message : "Provider 설정을 저장하지 못했습니다.");
    } finally {
      setIsSavingProvider(false);
    }
  };

  const loginChatGPT = async () => {
    if (chatGPTLoginUrl) {
      await openExternalUrl(chatGPTLoginUrl);
      return;
    }

    setIsChatGPTLoginBusy(true);
    try {
      const auth = await invoke<StartChatgptLoginPayload>("begin_chatgpt_login");
      setChatGPTLoginUrl(auth.authorizationUrl);
      await openExternalUrl(auth.authorizationUrl);
      setPanelModalError("");
      setIsChatGPTLoginBusy(false);

      const timeoutAt = Date.now() + 305_000;
      while (Date.now() < timeoutAt) {
        await new Promise((resolve) => {
          setTimeout(resolve, 1200);
        });

        const next = await invoke<LLMSettings>("get_llm_settings");
        setSettings(normalizeLlmSettings(next));
        if (next.chatgptLoggedIn) {
          setChatGPTLoginUrl("");
          return;
        }
      }

      setPanelModalError("로그인 시간이 초과되었습니다. 브라우저에서 인증을 완료한 뒤 다시 시도해 주세요.");
    } catch (error) {
      setPanelModalError(
        error instanceof Error ? error.message : `ChatGPT 로그인에 실패했습니다: ${String(error)}`
      );
    } finally {
      setIsChatGPTLoginBusy(false);
    }
  };

  const logoutChatGPT = async () => {
    setIsChatGPTLoginBusy(true);
    try {
      const next = await invoke<LLMSettings>("logout_chatgpt");
      setSettings(normalizeLlmSettings(next));
      setChatGPTLoginUrl("");
      setPanelModalError("");
    } catch (error) {
      setPanelModalError(error instanceof Error ? error.message : "ChatGPT 로그아웃에 실패했습니다.");
    } finally {
      setIsChatGPTLoginBusy(false);
    }
  };

  return {
    activity,
    agents,
    canSend,
    chatGPTLoginUrl,
    clearContext,
    costPercent,
    currentSessionId,
    currentSessionProjectPaths,
    currentSessionTitle,
    exportChat,
    getModeDefaultModel,
    getModeIcon,
    getModeProjectPaths,
    handleApprovePlan,
    handleModifyPlan,
    handleSessionDelete,
    handleSessionSelect,
    inputValue,
    isChatGPTLoginBusy,
    isPanelModalOpen,
    isSavingProvider,
    loginChatGPT,
    logoutChatGPT,
    messages,
    modes,
    onEnterSubmit,
    openSelectedModeSignal,
    panelModalError,
    resourceCost,
    resourceToken,
    openProjectFolder,
    saveAgentsForSelectedMode,
    saveOperationModeSettings,
    savePanelModalSettings,
    selectOperationMode,
    selectedMode,
    sendMessage,
    sessionsByMode,
    setInputValue,
    setIsPanelModalOpen,
    setPanelModalError,
    setSettings: (next: SetStateAction<LLMSettings>) => {
      if (typeof next === "function") {
        setSettings((prev) => normalizeLlmSettings((next as (prev: LLMSettings) => LLMSettings)(prev)));
        return;
      }
      setSettings(normalizeLlmSettings(next));
    },
    settings,
    startNewChat,
    theme,
    toggleTheme,
    tokenPercent,
    updateCurrentSessionProjectPaths,
  };
}
