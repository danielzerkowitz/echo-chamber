import OpenAI from "openai";
import type { LlmRequest, StreamEvent } from "./types";

export async function* streamOpenAI(req: LlmRequest): AsyncGenerator<StreamEvent> {
  const client = new OpenAI({ apiKey: req.apiKey });

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined = req.tools?.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  try {
    const stream = await client.chat.completions.create({
      model: req.model,
      stream: true,
      max_tokens: req.maxTokens,
      ...(req.temperature != null ? { temperature: req.temperature } : {}),
      ...(tools && tools.length > 0 ? { tools } : {}),
      messages: [
        { role: "system", content: req.system },
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    // Accumulate streamed tool-call argument fragments by index.
    const toolCalls = new Map<number, { name: string; args: string }>();
    let stopReason = "end_turn";

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (delta?.content) {
        yield { type: "text_delta", text: delta.content };
      }
      for (const tc of delta?.tool_calls ?? []) {
        const entry = toolCalls.get(tc.index) ?? { name: "", args: "" };
        if (tc.function?.name) entry.name += tc.function.name;
        if (tc.function?.arguments) entry.args += tc.function.arguments;
        toolCalls.set(tc.index, entry);
      }
      if (choice.finish_reason) {
        stopReason = choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason;
      }
    }

    for (const { name, args } of toolCalls.values()) {
      let input: Record<string, unknown> = {};
      try {
        input = args.trim() ? JSON.parse(args) : {};
      } catch {
        input = {};
      }
      yield { type: "tool_call", name, input };
    }
    yield { type: "done", stopReason };
  } catch (err) {
    const message = err instanceof OpenAI.APIError ? `OpenAI: ${err.message}` : String(err);
    yield { type: "error", message };
  }
}
