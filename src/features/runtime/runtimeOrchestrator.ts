import { invoke } from "@tauri-apps/api/core";

import { composeAgentSystemPrompt } from "@/features/app/config/appData";
import { request, type LLMMessage } from "@/lib/llm";
import type { AgentItem, ResolvedLLMSettings } from "@/types/chat";
import { parseJsonObject } from "@/features/app/appHelpers";

type WorkspaceFileMatch = {
  path: string;
  lineNumber: number;
  line: string;
};

type WorkspaceDocument = {
  name: string;
  description: string;
  path: string;
  content: string;
};

type WorkspaceSkillSummary = {
  name: string;
  description: string;
  path: string;
};

type WorkspaceCommandSummary = {
  name: string;
  description: string;
  path: string;
  hints: string[];
};

type CommandLineResult = {
  command: string;
  cwd: string;
  shell: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  success: boolean;
};

type RuntimeAction =
  | {
      type: "tool";
      toolName: "workspace_search" | "workspace_read_file" | "workspace_list_files";
      input?: Record<string, unknown>;
      reason?: string;
    }
  | {
      type: "mcp";
      server: "workspace";
      operation: "search_text" | "read_file" | "list_files";
      input?: Record<string, unknown>;
      reason?: string;
    }
  | {
      type: "skill";
      name: string;
      reason?: string;
    }
  | {
      type: "command";
      name: string;
      arguments?: string;
      reason?: string;
    }
  | {
      type: "shell";
      command: string;
      cwd?: string;
      reason?: string;
    };

type RuntimePlan = {
  shouldUseRuntime: boolean;
  summary?: string;
  actions: RuntimeAction[];
};

type RuntimeExecutionLog = {
  title: string;
  detail: string;
};

type RuntimeExecutionArtifact = {
  kind: string;
  title: string;
  content: string;
};

type RuntimeExecutionResult = {
  plan: RuntimePlan;
  logs: string[];
  artifacts: RuntimeExecutionArtifact[];
};

type RuntimeCatalog = {
  skills: WorkspaceSkillSummary[];
  commands: WorkspaceCommandSummary[];
};

type ExecuteRuntimeInput = {
  text: string;
  mainAgent: AgentItem;
  requestMessages: LLMMessage[];
  activeSettings: ResolvedLLMSettings;
  projectPaths: string[];
  onStatus?: (statusText: string) => void;
};

const BUILTIN_TOOL_LINES = [
  "- workspace_search: 프로젝트 경로 안에서 텍스트를 검색한다. 입력 예시: {\"query\":\"tool registry\"}",
  "- workspace_read_file: 파일 내용을 읽는다. 입력 예시: {\"path\":\"C:/repo/src/App.tsx\"}",
  "- workspace_list_files: 파일 경로 목록을 나열한다. 입력 예시: {\"query\":\"prompt\"}",
];

const MCP_LINES = [
  "- workspace.search_text: 워크스페이스 텍스트 검색",
  "- workspace.read_file: 워크스페이스 파일 읽기",
  "- workspace.list_files: 워크스페이스 파일 목록 조회",
];

export async function executeRuntimePlan(
  input: ExecuteRuntimeInput
): Promise<RuntimeExecutionResult | null> {
  if (input.projectPaths.length === 0) {
    return null;
  }

  const catalog = await loadRuntimeCatalog(input.projectPaths);
  const plan = await decideRuntimePlan({
    text: input.text,
    mainAgent: input.mainAgent,
    requestMessages: input.requestMessages,
    activeSettings: input.activeSettings,
    projectPaths: input.projectPaths,
    catalog,
  });

  if (!plan?.shouldUseRuntime || plan.actions.length === 0) {
    return null;
  }

  const artifacts: RuntimeExecutionArtifact[] = [];
  const actionLogs: RuntimeExecutionLog[] = [];

  for (const action of plan.actions.slice(0, 6)) {
    const statusText = formatActionStatus(action);
    input.onStatus?.(statusText);
    const result = await executeAction(action, input.projectPaths, catalog);
    artifacts.push(...result.artifacts);
    actionLogs.push(...result.logs);
  }

  const logs = [
    plan.summary ? `plan: ${plan.summary}` : null,
    ...actionLogs.map((entry) => `${entry.title}\n${entry.detail}`.trim()),
  ].filter((value): value is string => Boolean(value));

  return {
    plan,
    logs,
    artifacts,
  };
}

export async function synthesizeRuntimeResponse(input: {
  text: string;
  mainAgent: AgentItem;
  requestMessages: LLMMessage[];
  activeSettings: ResolvedLLMSettings;
  runtimeResult: RuntimeExecutionResult;
  onChunk?: (chunk: string) => void;
}): Promise<{ text: string; usage?: { totalTokens?: number } }> {
  let streamedText = "";

  const synthesisPrompt = [
    "You are the main orchestration agent.",
    "Use the runtime execution results below as grounded working context.",
    "Summarize what was discovered, answer the user directly, and mention any limitations when relevant.",
    "",
    `Latest user request:\n${input.text}`,
    "",
    "Runtime execution logs:",
    input.runtimeResult.logs.join("\n\n") || "No logs.",
    "",
    "Runtime artifacts:",
    input.runtimeResult.artifacts
      .map((artifact) => `[${artifact.kind}] ${artifact.title}\n${artifact.content}`)
      .join("\n\n") || "No artifacts.",
  ].join("\n");

  const response = await request({
    providerId: input.activeSettings.providerId,
    providerKind: input.activeSettings.providerKind,
    apiBaseUrl: input.activeSettings.baseUrl,
    apiKey: input.activeSettings.apiKey,
    accessToken: input.activeSettings.accessToken,
    accountId: input.activeSettings.accountId,
    model: input.mainAgent.model?.trim() || input.activeSettings.model,
    messages: [
      {
        role: "system",
        content: composeAgentSystemPrompt(
          input.mainAgent.model?.trim() || input.activeSettings.model,
          input.mainAgent.prompt,
          "You are synthesizing tool, MCP, skill, command, and shell execution results into a final answer."
        ),
      },
      ...input.requestMessages.slice(1),
      {
        role: "user",
        content: synthesisPrompt,
      },
    ],
    stream: true,
    onChunk: (chunk) => {
      streamedText += chunk;
      input.onChunk?.(chunk);
    },
  });

  return {
    text: response.text || streamedText,
    usage: response.usage,
  };
}

async function decideRuntimePlan(input: {
  text: string;
  mainAgent: AgentItem;
  requestMessages: LLMMessage[];
  activeSettings: ResolvedLLMSettings;
  projectPaths: string[];
  catalog: RuntimeCatalog;
}): Promise<RuntimePlan | null> {
  const skillsText =
    input.catalog.skills.length > 0
      ? input.catalog.skills
          .map((skill) => `- ${skill.name}: ${skill.description}`)
          .join("\n")
      : "- none";
  const commandsText =
    input.catalog.commands.length > 0
      ? input.catalog.commands
          .map(
            (command) =>
              `- ${command.name}: ${command.description}${command.hints.length ? ` | hints: ${command.hints.join(", ")}` : ""}`
          )
          .join("\n")
      : "- none";

  const routingPrompt = [
    "You are planning runtime actions for a local coding assistant.",
    "Choose runtime actions only when they materially help answer the request.",
    "Prefer a small action list. Skip runtime for simple conversational requests.",
    "You may use tool, mcp, skill, command, or shell actions.",
    "Shell commands should be used only when a direct command line execution is clearly useful.",
    "Return strict JSON only.",
    "",
    "JSON schema:",
    '{"shouldUseRuntime":boolean,"summary":"string","actions":[{"type":"tool|mcp|skill|command|shell","reason":"string", "...":"fields depending on type"}]}',
    "",
    "Tool fields:",
    '- tool => {"type":"tool","toolName":"workspace_search|workspace_read_file|workspace_list_files","input":{...}}',
    '- mcp => {"type":"mcp","server":"workspace","operation":"search_text|read_file|list_files","input":{...}}',
    '- skill => {"type":"skill","name":"skill name"}',
    '- command => {"type":"command","name":"command name","arguments":"free text args"}',
    '- shell => {"type":"shell","command":"actual shell command","cwd":"optional path"}',
    "",
    `Project paths:\n${input.projectPaths.join("\n")}`,
    "",
    "Available built-in tools:",
    ...BUILTIN_TOOL_LINES,
    "",
    "Available MCP operations:",
    ...MCP_LINES,
    "",
    "Available skills:",
    skillsText,
    "",
    "Available commands:",
    commandsText,
    "",
    `Latest user request:\n${input.text}`,
  ].join("\n");

  const response = await request({
    providerId: input.activeSettings.providerId,
    providerKind: input.activeSettings.providerKind,
    apiBaseUrl: input.activeSettings.baseUrl,
    apiKey: input.activeSettings.apiKey,
    accessToken: input.activeSettings.accessToken,
    accountId: input.activeSettings.accountId,
    model: input.mainAgent.model?.trim() || input.activeSettings.model,
    messages: [
      {
        role: "system",
        content: composeAgentSystemPrompt(
          input.mainAgent.model?.trim() || input.activeSettings.model,
          input.mainAgent.prompt,
          "You are acting as a runtime planner. Return JSON only."
        ),
      },
      ...input.requestMessages.slice(1),
      {
        role: "user",
        content: routingPrompt,
      },
    ],
    stream: false,
  });

  const parsed = parseJsonObject<RuntimePlan>(response.text);
  if (!parsed || !Array.isArray(parsed.actions)) {
    return null;
  }

  return {
    shouldUseRuntime: Boolean(parsed.shouldUseRuntime),
    summary: parsed.summary?.trim(),
    actions: parsed.actions.filter(Boolean),
  };
}

async function loadRuntimeCatalog(projectPaths: string[]): Promise<RuntimeCatalog> {
  const [skills, commands] = await Promise.all([
    invoke<WorkspaceSkillSummary[]>("list_workspace_skills", {
      projectPaths,
    }).catch(() => []),
    invoke<WorkspaceCommandSummary[]>("list_workspace_commands", {
      projectPaths,
    }).catch(() => []),
  ]);

  return {
    skills,
    commands,
  };
}

async function executeAction(
  action: RuntimeAction,
  projectPaths: string[],
  catalog: RuntimeCatalog
): Promise<{ logs: RuntimeExecutionLog[]; artifacts: RuntimeExecutionArtifact[] }> {
  switch (action.type) {
    case "tool":
      return executeToolAction(action, projectPaths);
    case "mcp":
      return executeMcpAction(action, projectPaths);
    case "skill":
      return executeSkillAction(action, catalog);
    case "command":
      return executeCommandAction(action, catalog);
    case "shell":
      return executeShellAction(action);
    default:
      return {
        logs: [
          {
            title: "runtime",
            detail: "지원하지 않는 액션 타입이 요청되었습니다.",
          },
        ],
        artifacts: [],
      };
  }
}

async function executeToolAction(
  action: Extract<RuntimeAction, { type: "tool" }>,
  projectPaths: string[]
) {
  if (action.toolName === "workspace_search") {
    const query = getStringInput(action.input, "query");
    const matches = query
      ? await invoke<WorkspaceFileMatch[]>("search_workspace_text", {
          projectPaths,
          query,
          limit: 20,
        }).catch(() => [])
      : [];
    return {
      logs: [
        {
          title: `tool: ${action.toolName}`,
          detail: query ? `query="${query}" (${matches.length} matches)` : "query missing",
        },
      ],
      artifacts: [
        {
          kind: "tool",
          title: `workspace_search ${query || ""}`.trim(),
          content: matches
            .map((match) => `${match.path}:${match.lineNumber}\n${match.line}`)
            .join("\n\n"),
        },
      ],
    };
  }

  if (action.toolName === "workspace_read_file") {
    const path = getStringInput(action.input, "path");
    const content = path
      ? await invoke<string>("read_workspace_file", { path }).catch((error) => String(error))
      : "path missing";
    return {
      logs: [
        {
          title: `tool: ${action.toolName}`,
          detail: path || "path missing",
        },
      ],
      artifacts: [
        {
          kind: "tool",
          title: path || "workspace_read_file",
          content,
        },
      ],
    };
  }

  const query = getStringInput(action.input, "query");
  const files = await invoke<string[]>("list_workspace_files", {
    projectPaths,
    query: query || null,
    limit: 100,
  }).catch(() => []);
  return {
    logs: [
      {
        title: `tool: ${action.toolName}`,
        detail: `${files.length} files listed`,
      },
    ],
    artifacts: [
      {
        kind: "tool",
        title: "workspace_list_files",
        content: files.join("\n"),
      },
    ],
  };
}

async function executeMcpAction(
  action: Extract<RuntimeAction, { type: "mcp" }>,
  projectPaths: string[]
) {
  const translated =
    action.operation === "search_text"
      ? ({
          type: "tool",
          toolName: "workspace_search",
          input: action.input,
        } as const)
      : action.operation === "read_file"
        ? ({
            type: "tool",
            toolName: "workspace_read_file",
            input: action.input,
          } as const)
        : ({
            type: "tool",
            toolName: "workspace_list_files",
            input: action.input,
          } as const);

  const result = await executeToolAction(translated, projectPaths);
  return {
    logs: result.logs.map((entry) => ({
      title: `mcp: ${action.server}.${action.operation}`,
      detail: entry.detail,
    })),
    artifacts: result.artifacts.map((artifact) => ({
      ...artifact,
      kind: "mcp",
      title: `${action.server}.${action.operation} - ${artifact.title}`,
    })),
  };
}

async function executeSkillAction(
  action: Extract<RuntimeAction, { type: "skill" }>,
  catalog: RuntimeCatalog
) {
  const target = catalog.skills.find((skill) => skill.name === action.name);
  if (!target) {
    return {
      logs: [
        {
          title: `skill: ${action.name}`,
          detail: "등록된 skill을 찾지 못했습니다.",
        },
      ],
      artifacts: [],
    };
  }

  const loaded = await invoke<WorkspaceDocument>("load_workspace_skill", {
    path: target.path,
  }).catch(() => null);

  return {
    logs: [
      {
        title: `skill: ${action.name}`,
        detail: target.path,
      },
    ],
    artifacts: loaded
      ? [
          {
            kind: "skill",
            title: loaded.name,
            content: loaded.content,
          },
        ]
      : [],
  };
}

async function executeCommandAction(
  action: Extract<RuntimeAction, { type: "command" }>,
  catalog: RuntimeCatalog
) {
  const target = catalog.commands.find((command) => command.name === action.name);
  if (!target) {
    return {
      logs: [
        {
          title: `command: ${action.name}`,
          detail: "등록된 command를 찾지 못했습니다.",
        },
      ],
      artifacts: [],
    };
  }

  const loaded = await invoke<WorkspaceDocument>("load_workspace_command", {
    path: target.path,
  }).catch(() => null);

  const rendered = loaded
    ? renderCommandTemplate(loaded.content, action.arguments || "")
    : action.arguments || "";

  return {
    logs: [
      {
        title: `command: ${action.name}`,
        detail: action.arguments?.trim() ? `args="${action.arguments}"` : target.path,
      },
    ],
    artifacts: rendered
      ? [
          {
            kind: "command",
            title: action.name,
            content: rendered,
          },
        ]
      : [],
  };
}

async function executeShellAction(action: Extract<RuntimeAction, { type: "shell" }>) {
  const result = await invoke<CommandLineResult>("run_command_line", {
    input: {
      command: action.command,
      cwd: action.cwd || null,
    },
  }).catch((error): CommandLineResult => ({
    command: action.command,
    cwd: action.cwd || "",
    shell: "",
    exitCode: null,
    stdout: "",
    stderr: String(error),
    combinedOutput: String(error),
    success: false,
  }));

  return {
    logs: [
      {
        title: `shell: ${action.command}`,
        detail: `shell=${result.shell} exit=${result.exitCode ?? "unknown"} cwd=${result.cwd}`,
      },
    ],
    artifacts: [
      {
        kind: "shell",
        title: action.command,
        content: result.combinedOutput || "(no output)",
      },
    ],
  };
}

function getStringInput(input: Record<string, unknown> | undefined, key: string): string {
  const value = input?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function renderCommandTemplate(template: string, argumentsText: string): string {
  const trimmedArgs = argumentsText.trim();
  let rendered = template.split("$ARGUMENTS").join(trimmedArgs);
  const args = trimmedArgs.length > 0 ? trimmedArgs.split(/\s+/) : [];

  rendered = rendered.replace(/\$(\d+)/g, (_match: string, rawIndex: string) => {
    const index = Number(rawIndex) - 1;
    return args[index] ?? "";
  });

  return rendered.trim();
}

function formatActionStatus(action: RuntimeAction): string {
  switch (action.type) {
    case "tool":
      return `Running tool: ${action.toolName}`;
    case "mcp":
      return `Calling MCP: ${action.server}.${action.operation}`;
    case "skill":
      return `Loading skill: ${action.name}`;
    case "command":
      return `Resolving command: ${action.name}`;
    case "shell":
      return `Executing shell: ${action.command}`;
    default:
      return "Running runtime action";
  }
}
