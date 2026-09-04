"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readSseStream, type SseEvent } from "@/lib/sse";

export interface StreamingTurn {
  botId: string;
  text: string;
}

interface ConductorState {
  typingBotId: string | null;
  streaming: StreamingTurn | null;
  error: string | null;
  running: boolean;
}

// Client half of the step loop: repeatedly POST /step; each request streams one
// bot turn. onTurnEnd receives the persisted message id + full text so the UI
// can show the bubble before the Realtime insert arrives.
export function useStepLoop(
  stepUrl: string,
  onTurnEnd: (botId: string, messageId: string | undefined, text: string) => void,
  onTool?: (event: Extract<SseEvent, { type: "tool" }>) => void
) {
  const [state, setState] = useState<ConductorState>({
    typingBotId: null,
    streaming: null,
    error: null,
    running: false,
  });
  const runningRef = useRef(false);
  const stoppedRef = useRef(false);
  const pendingKickRef = useRef(false);

  const runLoop = useCallback(async () => {
    if (runningRef.current) {
      // A kick while running (e.g. a message sent mid-round) queues one rerun
      // so the new message can't slip through after this round completes.
      pendingKickRef.current = true;
      return;
    }
    runningRef.current = true;
    setState((s) => ({ ...s, running: true, error: null }));
    let retries = 0;

    try {
      for (;;) {
        if (stoppedRef.current) break;
        pendingKickRef.current = false;
        const res = await fetch(stepUrl, { method: "POST" });

        if (res.status === 409) {
          // Another tab (or an abandoned lock) holds this conversation. Keep
          // polling past the server's 90s lock TTL before giving up visibly.
          if (retries++ > 25) {
            setState((s) => ({
              ...s,
              error: "This conversation is busy in another window. It'll free up shortly — send a message to retry.",
            }));
            break;
          }
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setState((s) => ({ ...s, error: body?.error ?? `request failed (${res.status})` }));
          break;
        }
        if (!res.headers.get("content-type")?.includes("text/event-stream")) {
          break; // JSON response: round complete / nothing to do
        }
        retries = 0;

        let complete = true;
        let currentBot = "";
        let text = "";
        let errored = false;

        await readSseStream(res, (event) => {
          if (event.type === "turn_start") {
            currentBot = event.botId;
            text = "";
            setState((s) => ({ ...s, typingBotId: event.botId, streaming: null }));
          } else if (event.type === "delta") {
            text += event.text;
            const snapshot = text;
            setState((s) => ({ ...s, typingBotId: null, streaming: { botId: currentBot, text: snapshot } }));
          } else if (event.type === "tool") {
            onTool?.(event);
          } else if (event.type === "turn_end") {
            if (!event.silent && text.trim()) {
              onTurnEnd(currentBot, event.messageId, text.trim());
            }
            setState((s) => ({ ...s, typingBotId: null, streaming: null }));
          } else if (event.type === "round") {
            complete = event.complete;
            if (!complete && event.nextBotId) {
              setState((s) => ({ ...s, typingBotId: event.nextBotId ?? null }));
            }
          } else if (event.type === "error") {
            errored = true;
            setState((s) => ({ ...s, typingBotId: null, streaming: null, error: event.message }));
          }
        });

        if (errored) break;
        if (complete && !pendingKickRef.current) break;
      }
    } finally {
      runningRef.current = false;
      setState((s) => ({ ...s, running: false, typingBotId: null, streaming: null }));
      if (pendingKickRef.current && !stoppedRef.current) {
        pendingKickRef.current = false;
        setTimeout(() => void runLoop(), 0);
      }
    }
  }, [stepUrl, onTurnEnd, onTool]);

  // Resume an in-flight round after refresh/navigation.
  useEffect(() => {
    stoppedRef.current = false;
    void runLoop();
    return () => {
      stoppedRef.current = true;
    };
  }, [runLoop]);

  return { ...state, kick: runLoop };
}

export function useChatConductor(
  chatId: string,
  onTurnEnd: (botId: string, messageId: string | undefined, text: string) => void,
  onTool?: (event: Extract<SseEvent, { type: "tool" }>) => void
) {
  return useStepLoop(`/api/chats/${chatId}/step`, onTurnEnd, onTool);
}
