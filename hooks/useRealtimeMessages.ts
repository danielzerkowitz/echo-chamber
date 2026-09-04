"use client";

import { useCallback, useEffect, useState } from "react";
import { useAppData } from "@/components/providers/AppData";
import type { Message } from "@/lib/db/types";

// Messages for one chat: initial fetch + realtime inserts + local additions
// (optimistic sends, just-streamed bot turns), deduped by id.
export function useRealtimeMessages(chatId: string) {
  const { supabase } = useAppData();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);

  const addMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      const next = [...prev, msg];
      next.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(500)
      .then(({ data }) => {
        if (cancelled) return;
        // Merge with anything realtime delivered while the fetch was in flight.
        setMessages((prev) => {
          const merged = [...((data as Message[]) ?? [])];
          for (const msg of prev) {
            if (msg.chat_id === chatId && !merged.some((m) => m.id === msg.id)) merged.push(msg);
          }
          merged.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
          return merged;
        });
        setLoaded(true);
      });

    const channel = supabase
      .channel(`chat-${chatId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        (payload) => addMessage(payload.new as Message)
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [supabase, chatId, addMessage]);

  // State may briefly hold rows from a previously viewed chat; render only this chat's.
  return { messages: messages.filter((m) => m.chat_id === chatId), loaded, addMessage };
}
