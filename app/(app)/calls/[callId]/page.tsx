"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppData } from "@/components/providers/AppData";
import { useStepLoop } from "@/hooks/useStepLoop";
import { BotAvatar } from "@/components/bots/BotAvatar";
import { formatClock } from "@/lib/format";
import type { Call, CallMessage } from "@/lib/db/types";

export default function CallPage({ params }: { params: Promise<{ callId: string }> }) {
  const { callId } = use(params);
  const router = useRouter();
  const { userId, bots, supabase } = useAppData();
  const [call, setCall] = useState<Call | null>(null);
  const [messages, setMessages] = useState<CallMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [hangingUp, setHangingUp] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const botA = call ? botsById.get(call.bot_a) : null;
  const botB = call ? botsById.get(call.bot_b) : null;

  const addMessage = useCallback((msg: CallMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      const next = [...prev, msg];
      next.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      supabase.from("calls").select("*").eq("id", callId).single(),
      supabase.from("call_messages").select("*").eq("call_id", callId).order("created_at", { ascending: true }),
    ]).then(([callRes, msgRes]) => {
      if (cancelled) return;
      setCall(callRes.data as Call);
      setMessages((msgRes.data as CallMessage[]) ?? []);
    });

    const channel = supabase
      .channel(`call-${callId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "call_messages", filter: `call_id=eq.${callId}` },
        (payload) => addMessage(payload.new as CallMessage)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "calls", filter: `id=eq.${callId}` },
        (payload) => setCall(payload.new as Call)
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [supabase, callId, addMessage]);

  const onTurnEnd = useCallback(
    (botId: string, messageId: string | undefined, text: string) => {
      if (!messageId) return;
      addMessage({
        id: messageId,
        call_id: callId,
        user_id: userId,
        sender_type: "bot",
        bot_id: botId,
        content: text,
        created_at: new Date().toISOString(),
      });
    },
    [addMessage, callId, userId]
  );

  const conductor = useStepLoop(`/api/calls/${callId}/step`, onTurnEnd);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, conductor.streaming?.text]);

  const active = call?.status === "active";
  const speakingBotId = conductor.streaming?.botId ?? conductor.typingBotId;

  async function interject() {
    const content = draft.trim();
    if (!content || !call) return;
    setDraft("");
    const { data } = await supabase
      .from("call_messages")
      .insert({ call_id: callId, user_id: userId, sender_type: "user", content })
      .select()
      .single();
    if (data) addMessage(data as CallMessage);
    void conductor.kick();
  }

  async function hangUp() {
    setHangingUp(true);
    await fetch(`/api/calls/${callId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "end" }),
    });
    setHangingUp(false);
    if (call?.chat_id) router.push(`/chats/${call.chat_id}`);
    else router.push("/");
  }

  if (!call || !botA || !botB) {
    return <div className="flex h-full items-center justify-center bg-wa-header text-white/70">Connecting…</div>;
  }

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-wa-accent-deep to-[#0b3d33] text-white">
      {/* call header */}
      <div className="flex flex-col items-center gap-3 pb-4 pt-8">
        <div className="flex items-center gap-8">
          {[botA, botB].map((bot) => (
            <div key={bot.id} className="flex flex-col items-center gap-2">
              <div className={speakingBotId === bot.id && active ? "call-pulse rounded-full" : ""}>
                <BotAvatar bot={bot} size={84} />
              </div>
              <p className="font-medium">{bot.name}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-white/70">
          {active
            ? speakingBotId
              ? `${botsById.get(speakingBotId)?.name ?? "…"} is speaking…`
              : "On a call"
            : "Call ended"}
        </p>
        <p className="text-xs text-white/50">
          {Math.min(Math.floor(call.rounds_used / 2), call.round_limit)} / {call.round_limit} exchanges
        </p>
      </div>

      {/* transcript */}
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-2 overflow-y-auto px-4 pb-4">
        {messages.map((msg) => {
          const bot = msg.bot_id ? botsById.get(msg.bot_id) : null;
          const own = msg.sender_type === "user";
          return (
            <div key={msg.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${own ? "bg-wa-accent" : "bg-white/10"}`}>
                {!own && (
                  <p className="text-xs font-semibold" style={{ color: bot?.avatar_color }}>
                    {bot?.name ?? "Bot"}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words text-[15px]">{msg.content}</p>
                <p className="mt-0.5 text-right text-[10px] text-white/50">{formatClock(msg.created_at)}</p>
              </div>
            </div>
          );
        })}
        {conductor.streaming && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl bg-white/10 px-4 py-2">
              <p className="text-xs font-semibold" style={{ color: botsById.get(conductor.streaming.botId)?.avatar_color }}>
                {botsById.get(conductor.streaming.botId)?.name}
              </p>
              <p className="whitespace-pre-wrap break-words text-[15px]">
                {conductor.streaming.text}
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-white/50 align-middle" />
              </p>
            </div>
          </div>
        )}
        {conductor.error && (
          <p className="text-center text-sm text-red-300">{conductor.error}</p>
        )}
        {!active && call.summary && (
          <div className="rounded-lg bg-white/10 p-3 text-center text-sm text-white/80">📝 {call.summary}</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* controls */}
      <div className="mx-auto w-full max-w-2xl px-4 pb-6">
        {active ? (
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void interject();
                }
              }}
              rows={1}
              placeholder="Chime in…"
              className="max-h-24 flex-1 resize-none rounded-full bg-white/10 px-4 py-2.5 text-white outline-none placeholder:text-white/50"
            />
            <button
              onClick={() => void interject()}
              disabled={!draft.trim()}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-wa-accent hover:bg-wa-accent/80 disabled:opacity-40"
              aria-label="Send"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z" />
              </svg>
            </button>
            <button
              onClick={() => void hangUp()}
              disabled={hangingUp}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-red-500 hover:bg-red-600 disabled:opacity-50"
              title="Hang up"
              aria-label="Hang up"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" className="rotate-[135deg]">
                <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            onClick={() => (call.chat_id ? router.push(`/chats/${call.chat_id}`) : router.push("/"))}
            className="w-full rounded-full bg-white/10 py-2.5 text-white hover:bg-white/20"
          >
            ← Back {call.chat_id ? "to chat" : "home"}
          </button>
        )}
      </div>
    </div>
  );
}
