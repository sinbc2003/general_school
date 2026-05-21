export type ToolKind = "doc" | "sheet" | "slide" | "survey" | "drive";

export interface ToolModel {
  id: number;
  provider: string;
  model_id: string;
  display_name: string;
  input_per_1m_usd: number;
  output_per_1m_usd: number;
  available: boolean;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface ToolChatResponse {
  text: string;
  tool_calls: ToolCall[];
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  error?: string | null;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  tool_calls?: ToolCall[];
  applied?: Record<number, boolean>; // tool_call idx → applied
  error?: string;
}

/** 도구별 적용 핸들러 — frontend가 실제로 변경 적용. */
export type ApplyHandler = (call: ToolCall) => Promise<void>;
