export type Provider = "anthropic" | "openai";

export interface ToolDef {
  name: string;
  description: string;
  // JSON Schema for the tool input.
  parameters: Record<string, unknown>;
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  provider: Provider;
  model: string;
  apiKey: string;
  system: string;
  messages: Turn[];
  tools?: ToolDef[];
  temperature?: number | null;
  maxTokens: number;
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; name: string; input: Record<string, unknown> }
  | { type: "done"; stopReason: string }
  | { type: "error"; message: string };

export interface ModelInfo {
  id: string;
  label: string;
  provider: Provider;
  supportsTemperature: boolean;
}
