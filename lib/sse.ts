// Server-sent-event helpers shared by the chat and call step routes and the
// client conductor hooks.

export type SseEvent =
  | { type: "turn_start"; botId: string }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; args: Record<string, unknown>; callId?: string }
  | { type: "turn_end"; messageId?: string; silent?: boolean }
  | { type: "round"; complete: boolean; nextBotId?: string | null }
  | { type: "error"; message: string; retryable?: boolean };

export function sseResponse(run: (emit: (event: SseEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: SseEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Client disconnected mid-stream; server work continues so the
          // message still gets persisted.
        }
      };
      try {
        await run(emit);
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// Client-side: read an SSE fetch response and invoke onEvent per event.
export async function readSseStream(response: Response, onEvent: (event: SseEvent) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("response has no body");
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as SseEvent);
      } catch {
        // skip malformed frame
      }
    }
  }
}
