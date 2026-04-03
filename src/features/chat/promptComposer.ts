import { getPromptForModel } from "@/data/llmCatalog";
import type { LLMConfig } from "@/types/chat";
import type { LLMToolDefinition } from "@/lib/llm";

import TOOL_USE_POLICY from "@/features/chat/prompts/tool-use-policy.txt?raw";

type ComposeChatSystemPromptInput = {
  model: string;
  providerId?: LLMConfig["providerId"];
  agentPrompt?: string;
  projectPaths: string[];
  tools: LLMToolDefinition[];
};

function buildEnvironmentSection(projectPaths: string[]) {
  const lines = [
    "Environment context:",
    `- Platform: ${navigator.platform || "unknown"}`,
    `- User agent: ${navigator.userAgent || "unknown"}`,
    `- Current date: ${new Date().toISOString().slice(0, 10)}`,
  ];

  if (projectPaths.length > 0) {
    lines.push("- Attached project paths:");
    lines.push(...projectPaths.map((path) => `  - ${path}`));
  } else {
    lines.push("- Attached project paths: none");
  }

  return lines.join("\n");
}

function buildToolSection(tools: LLMToolDefinition[]) {
  if (tools.length === 0) {
    return undefined;
  }

  return [
    "Available structured tools:",
    ...tools.map((tool) => `- ${tool.function.name}: ${tool.function.description}`),
  ].join("\n");
}

export function composeChatSystemPrompt(input: ComposeChatSystemPromptInput) {
  const sections = [
    getPromptForModel(input.model, input.providerId),
    input.agentPrompt?.trim(),
    TOOL_USE_POLICY.trim(),
    buildEnvironmentSection(input.projectPaths),
    buildToolSection(input.tools),
  ];

  return sections
    .map((section) => section?.trim())
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
}
