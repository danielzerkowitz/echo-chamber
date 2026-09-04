import type { LlmRequest, StreamEvent } from "./types";
import { streamAnthropic } from "./anthropic";
import { streamOpenAI } from "./openai";

export function streamChat(req: LlmRequest): AsyncGenerator<StreamEvent> {
  return req.provider === "anthropic" ? streamAnthropic(req) : streamOpenAI(req);
}

// Non-streaming convenience for short utility calls (call summaries).
export async function completeText(req: LlmRequest): Promise<string> {
  let text = "";
  for await (const event of streamChat(req)) {
    if (event.type === "text_delta") text += event.text;
    if (event.type === "error") throw new Error(event.message);
  }
  return text.trim();
}

export * from "./types";
export * from "./models";
