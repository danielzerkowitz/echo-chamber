"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { Bot, Chat, ChatParticipant, Message, ProviderKeyMeta } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";

interface AppData {
  userId: string;
  bots: Bot[];
  chats: Chat[];
  participants: ChatParticipant[];
  previews: Record<string, Message>;
  keys: ProviderKeyMeta[];
  refresh: () => Promise<void>;
  supabase: SupabaseClient;
}

const AppDataContext = createContext<AppData | null>(null);

export function useAppData(): AppData {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData outside provider");
  return ctx;
}

export function AppDataProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [bots, setBots] = useState<Bot[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [participants, setParticipants] = useState<ChatParticipant[]>([]);
  const [previews, setPreviews] = useState<Record<string, Message>>({});
  const [keys, setKeys] = useState<ProviderKeyMeta[]>([]);
  const loadedRef = useRef(false);

  const refresh = useCallback(async () => {
    const [botsRes, chatsRes, partsRes, keysRes, recentRes] = await Promise.all([
      supabase.from("bots").select("*").order("created_at", { ascending: true }),
      supabase.from("chats").select("*").order("last_message_at", { ascending: false }),
      supabase.from("chat_participants").select("*").is("left_at", null),
      supabase.from("provider_keys").select("id, user_id, provider, key_hint, created_at"),
      supabase.from("messages").select("*").order("created_at", { ascending: false }).limit(200),
    ]);
    setBots((botsRes.data as Bot[]) ?? []);
    setChats((chatsRes.data as Chat[]) ?? []);
    setParticipants((partsRes.data as ChatParticipant[]) ?? []);
    setKeys((keysRes.data as ProviderKeyMeta[]) ?? []);
    const byChat: Record<string, Message> = {};
    for (const msg of ((recentRes.data as Message[]) ?? []).reverse()) {
      byChat[msg.chat_id] = msg;
    }
    setPreviews(byChat);
  }, [supabase]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const channel = supabase
      .channel("app-data")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          setPreviews((prev) => ({ ...prev, [msg.chat_id]: msg }));
          setChats((prev) => {
            const idx = prev.findIndex((c) => c.id === msg.chat_id);
            if (idx < 0) return prev;
            const updated = [...prev];
            updated[idx] = { ...updated[idx], last_message_at: msg.created_at };
            updated.sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1));
            return updated;
          });
        }
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "chats" }, (payload) => {
        if (payload.eventType === "INSERT") {
          setChats((prev) =>
            prev.some((c) => c.id === (payload.new as Chat).id) ? prev : [payload.new as Chat, ...prev]
          );
        } else if (payload.eventType === "DELETE") {
          setChats((prev) => prev.filter((c) => c.id !== (payload.old as Chat).id));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_participants" }, () => {
        void supabase
          .from("chat_participants")
          .select("*")
          .is("left_at", null)
          .then(({ data }) => setParticipants((data as ChatParticipant[]) ?? []));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bots" }, () => {
        void supabase
          .from("bots")
          .select("*")
          .order("created_at", { ascending: true })
          .then(({ data }) => setBots((data as Bot[]) ?? []));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase]);

  const value = useMemo(
    () => ({ userId, bots, chats, participants, previews, keys, refresh, supabase }),
    [userId, bots, chats, participants, previews, keys, refresh, supabase]
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}
