type Status = "in_progress" | "completed" | "incomplete";
type Phase = "commentary" | "final_answer";

export type ReasoningSummaryItem = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

export type ReasoningContentItem = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

export type LocalShellStatus = "in_progress" | "completed" | "incomplete" | "failed";

export type LocalShellAction =
  | {
      type: "exec";
      command: string[];
      workdir?: string;
      timeout_ms?: number;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

export type FunctionCallOutputContentItem =
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_image";
      image_url: string;
      detail?: "auto" | "low" | "high" | "original";
    };

export type FunctionCallOutput = string | FunctionCallOutputContentItem[];

export type WebSearchAction =
  | {
      type: "search";
      query?: string;
      queries?: string[];
    }
  | {
      type: "open_page";
      url?: string;
    }
  | {
      type: "find_in_page";
      url?: string;
      pattern?: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

type ResponseInputText = {
  text: string;
  type: "input_text";
};
type ResponseInputImage = {
  detail?: "low" | "high" | "auto" | "original";
  type: "input_image";
  file_id?: string;
  image_url?: string;
};
type ResponseInputFile = {
  type: "input_text";
  file_data?: string;
  file_id?: string;
  file_url?: string;
  filename?: string;
};

type ResponseInputMessageContent = ResponseInputText | ResponseInputImage | ResponseInputFile;

// TODO: "assistant", "system" 제거
export type Message = {
  role: "developer" | "user" | "assistant" | "system";
  content: ResponseInputMessageContent[];
  status?: Status;
  type?: "message";
};

// TODO: annotations, logprobs 타입 정의
type ResponseOutputText = {
  annotations?: [] | object;
  logprobs?: [];
  text: string;
  type: "output_text";
};

type ResponseOutputRefusal = {
  refusal: string;
  type: "refusal";
};

export type ResponseOutputMessage = {
  id?: string;
  content: ResponseOutputText[] | ResponseOutputRefusal[];
  role: "assistant";
  status?: Status;
  type?: "message";
  phase?: Phase;
};

export type Reasoning = {
  type: "reasoning";
  summary: ReasoningSummaryItem[];
  content?: ReasoningContentItem[];
  encrypted_content: string | null;
};

export type LocalShellCall = {
  type: "local_shell_call";
  call_id?: string | null;
  status: LocalShellStatus;
  action: LocalShellAction;
};

export type FunctionCall = {
  type: "function_call";
  name: string;
  namespace?: string;
  arguments: string;
  call_id: string;
};

export type ToolSearchCall = {
  type: "tool_search_call";
  call_id?: string | null;
  status?: string;
  execution: string;
  arguments: unknown;
};

export type FunctionCallOutputItem = {
  type: "function_call_output";
  call_id: string;
  output: FunctionCallOutput;
};

export type CustomToolCall = {
  type: "custom_tool_call";
  status?: string;
  call_id: string;
  name: string;
  input: string;
};

export type CustomToolCallOutput = {
  type: "custom_tool_call_output";
  call_id: string;
  name?: string;
  output: FunctionCallOutput;
};

export type ToolSearchOutput = {
  type: "tool_search_output";
  call_id?: string | null;
  status: string;
  execution: string;
  tools: unknown[];
};

export type WebSearchCall = {
  type: "web_search_call";
  status?: string;
  action?: WebSearchAction;
};

export type ImageGenerationCall = {
  type: "image_generation_call";
  id: string;
  status: string;
  revised_prompt?: string;
  result: string;
};

export type GhostSnapshot = {
  type: "ghost_snapshot";
  ghost_commit: unknown;
};

export type Compaction = {
  type: "compaction";
  encrypted_content: string;
};

export type OtherResponseItem = {
  type: "other";
  [key: string]: unknown;
};

export type ResponseItem =
  | Message
  | Reasoning
  | LocalShellCall
  | FunctionCall
  | ToolSearchCall
  | FunctionCallOutputItem
  | CustomToolCall
  | CustomToolCallOutput
  | ToolSearchOutput
  | WebSearchCall
  | ImageGenerationCall
  | GhostSnapshot
  | Compaction
  | OtherResponseItem;

export type ReasoningConfig = {
  effort?: "minimal" | "low" | "medium" | "high";
  summary?: "auto" | "concise" | "detailed";
};

export type TextFormat = {
  type: "json_schema";
  strict: boolean;
  schema: Record<string, unknown>;
  name: string;
};

export type TextControls = {
  verbosity?: "low" | "medium" | "high";
  format?: TextFormat;
};

export type ToolDefinition = {
  type: "function";
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ResponsesApiRequest = {
  model: string;
  instructions: string;
  input: ResponseItem[];
  tools: ToolDefinition[];
  tool_choice: string;
  parallel_tool_calls: boolean;
  reasoning: ReasoningConfig | null;
  store: boolean;
  stream: boolean;
  include: string[];
  service_tier?: string;
  prompt_cache_key?: string;
  text?: TextControls | null;
};
