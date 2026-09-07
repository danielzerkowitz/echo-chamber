import Anthropic from "@anthropic-ai/sdk";
import type { LlmRequest, StreamEvent } from "./types";
import { modelSupportsTemperature } from "./models";

export async function* streamAnthropic(req: LlmRequest): AsyncGenerator<StreamEvent> {
  const client = new Anthropic({ apiKey: req.apiKey });

  const tools: Anthropic.Tool[] | undefined = req.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));

  const supportsTemperature = modelSupportsTemperature("anthropic", req.model);

  const params: Anthropic.MessageCreateParamsStreaming = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
    ...(tools && tools.length > 0 ? { tools } : {}),
    // Newest Anthropic models reject sampling params entirely.
    ...(supportsTemperature && req.temperature != null ? { temperature: req.temperature } : {}),
  };

  try {
    const stream = await client.messages.create(params);
    let toolName: string | null = null;
    let toolJson = "";
    let stopReason = "end_turn";

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          toolName = event.content_block.name;
          toolJson = "";
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "text_delta", text: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          toolJson += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (toolName) {
          let input: Record<string, unknown> = {};
          try {
            input = toolJson.trim() ? JSON.parse(toolJson) : {};
          } catch {
            input = {};
          }
          yield { type: "tool_call", name: toolName, input };
          toolName = null;
        }
      } else if (event.type === "message_delta") {
        if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
      }
    }
    yield { type: "done", stopReason };
  } catch (err) {
    const message = err instanceof Anthropic.APIError ? `Anthropic: ${err.message}` : String(err);
    yield { type: "error", message };
  }
}
