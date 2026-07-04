import { invoke } from "@tauri-apps/api/core";

import type { LLMToolCall, LLMToolDefinition } from "@/features/ai";

import SHELL_COMMAND_PROMPT from "@/features/chat/tools/prompts/shell-command.txt?raw";
import WORKSPACE_LIST_FILES_PROMPT from "@/features/chat/tools/prompts/workspace-list-files.txt?raw";
import WORKSPACE_READ_FILE_PROMPT from "@/features/chat/tools/prompts/workspace-read-file.txt?raw";
import WORKSPACE_SEARCH_PROMPT from "@/features/chat/tools/prompts/workspace-search.txt?raw";

type WorkspaceFileMatch = {
  path: string;
  lineNumber: number;
  line: string;
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

export type ChatToolExecutionResult = {
  toolName: string;
  title: string;
  content: string;
  logs: string[];
};

type ShellCommandArgs = {
  command: string;
  cwd?: string;
};

type WorkspaceSearchArgs = {
  query: string;
  rootPath?: string;
  limit?: number;
};

type WorkspaceReadFileArgs = {
  path: string;
  rootPath?: string;
};

type WorkspaceListFilesArgs = {
  rootPath?: string;
  query?: string;
  limit?: number;
};

const DEFAULT_FILE_LIMIT = 100;
const DEFAULT_SEARCH_LIMIT = 20;

function createObjectSchema(
  properties: Record<string, unknown>,
  required: string[]
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

function parseArguments<T>(raw: string): T {
  if (!raw.trim()) {
    return {} as T;
  }

  return JSON.parse(raw) as T;
}

function formatSearchMatches(matches: WorkspaceFileMatch[]) {
  if (matches.length === 0) {
    return "No matches found.";
  }

  return matches.map((match) => `${match.path}:${match.lineNumber}\n${match.line}`).join("\n\n");
}

export function createChatToolDefinitions(): LLMToolDefinition[] {
  const definitions: LLMToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "shell_command",
        description: SHELL_COMMAND_PROMPT.trim(),
        parameters: createObjectSchema(
          {
            command: {
              type: "string",
              description: "The shell command to execute.",
            },
            cwd: {
              type: "string",
              description: "Optional working directory for the command.",
            },
          },
          ["command"]
        ),
      },
    },
  ];

  definitions.push(
    {
      type: "function",
      function: {
        name: "workspace_search",
        description: WORKSPACE_SEARCH_PROMPT.trim(),
        parameters: createObjectSchema(
          {
            query: {
              type: "string",
              description: "Text or symbol query to search for.",
            },
            rootPath: {
              type: "string",
              description:
                "Optional folder path to search when the user provides a directory that is not attached to the session.",
            },
            limit: {
              type: "number",
              description: "Optional maximum number of matches to return.",
            },
          },
          ["query"]
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "workspace_read_file",
        description: WORKSPACE_READ_FILE_PROMPT.trim(),
        parameters: createObjectSchema(
          {
            path: {
              type: "string",
              description: "Absolute file path or a path relative to rootPath.",
            },
            rootPath: {
              type: "string",
              description: "Optional folder path used to resolve relative file paths.",
            },
          },
          ["path"]
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "workspace_list_files",
        description: WORKSPACE_LIST_FILES_PROMPT.trim(),
        parameters: createObjectSchema(
          {
            rootPath: {
              type: "string",
              description:
                "Optional folder path to list when the user provides a directory that is not attached to the session.",
            },
            query: {
              type: "string",
              description: "Optional filename/path filter.",
            },
            limit: {
              type: "number",
              description: "Optional maximum number of file paths to return.",
            },
          },
          []
        ),
      },
    }
  );

  return definitions;
}

export async function executeChatToolCall(
  toolCall: LLMToolCall,
  projectPaths: string[]
): Promise<ChatToolExecutionResult> {
  switch (toolCall.name) {
    case "shell_command": {
      const args = parseArguments<ShellCommandArgs>(toolCall.arguments);
      const result = await invoke<CommandLineResult>("run_command_line", {
        input: {
          command: args.command,
          cwd: args.cwd || null,
        },
      });

      return {
        toolName: toolCall.name,
        title: args.command || "shell_command",
        content: result.combinedOutput || "(no output)",
        logs: [
          `shell=${result.shell}`,
          `cwd=${result.cwd || args.cwd || ""}`,
          `exit=${result.exitCode ?? "unknown"}`,
        ],
      };
    }
    case "workspace_search": {
      const args = parseArguments<WorkspaceSearchArgs>(toolCall.arguments);
      const matches = await invoke<WorkspaceFileMatch[]>("search_workspace_text", {
        projectPaths,
        rootPath: args.rootPath || null,
        query: args.query,
        limit: args.limit ?? DEFAULT_SEARCH_LIMIT,
      });

      return {
        toolName: toolCall.name,
        title: args.query,
        content: formatSearchMatches(matches),
        logs: [`matches=${matches.length}`],
      };
    }
    case "workspace_read_file": {
      const args = parseArguments<WorkspaceReadFileArgs>(toolCall.arguments);
      const content = await invoke<string>("read_workspace_file", {
        path: args.path,
        rootPath: args.rootPath || null,
      });

      return {
        toolName: toolCall.name,
        title: args.path,
        content,
        logs: ["file read completed"],
      };
    }
    case "workspace_list_files": {
      const args = parseArguments<WorkspaceListFilesArgs>(toolCall.arguments);
      const files = await invoke<string[]>("list_workspace_files", {
        projectPaths,
        rootPath: args.rootPath || null,
        query: args.query || null,
        limit: args.limit ?? DEFAULT_FILE_LIMIT,
      });

      return {
        toolName: toolCall.name,
        title: args.query?.trim() || "workspace_list_files",
        content: files.length > 0 ? files.join("\n") : "No files found.",
        logs: [`files=${files.length}`],
      };
    }
    default:
      throw new Error(`Unsupported tool call: ${toolCall.name}`);
  }
}
