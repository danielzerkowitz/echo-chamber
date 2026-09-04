"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppData } from "@/components/providers/AppData";
import { useRealtimeMessages } from "@/hooks/useRealtimeMessages";
import { useChatConductor } from "@/hooks/useStepLoop";
import { BotAvatar, GroupAvatar } from "@/components/bots/BotAvatar";
import { Modal } from "@/components/ui/Modal";
import {
  DateDivider,
  MessageBubble,
  SystemEventPill,
  TypingIndicator,
  shouldShowTail,
} from "@/components/chat/Messages";
import { sameDay } from "@/lib/format";
import type { Bot, Message } from "@/lib/db/types";
import type { SseEvent } from "@/lib/sse";

export default function ChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = use(params);
  const router = useRouter();
  const { userId, bots, chats, participants, supabase } = useAppData();
  const { messages, addMessage } = useRealtimeMessages(chatId);
  const [draft, setDraft] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [addBotOpen, setAddBotOpen] = useState(false);
  const [callPickerOpen, setCallPickerOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const chat = chats.find((c) => c.id === chatId);
  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const chatBots = useMemo(
    () =>
      participants
        .filter((p) => p.chat_id === chatId)
        .map((p) => botsById.get(p.bot_id))
        .filter((b): b is Bot => Boolean(b)),
    [participants, chatId, botsById]
  );

  const onTurnEnd = useCallback(
    (botId: string, messageId: string | undefined, text: string) => {
      if (!messageId) return;
      addMessage({
        id: messageId,
        chat_id: chatId,
        user_id: userId,
        sender_type: "bot",
        bot_id: botId,
        kind: "text",
        content: text,
        metadata: {},
        created_at: new Date().toISOString(),
      });
    },
    [addMessage, chatId, userId]
  );

  const onTool = useCallback(
    (event: Extract<SseEvent, { type: "tool" }>) => {
      if (event.name === "call_bot" && event.callId) {
        router.push(`/calls/${event.callId}`);
      }
    },
    [router]
  );

  const conductor = useChatConductor(chatId, onTurnEnd, onTool);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, conductor.streaming?.text, conductor.typingBotId]);

  async function send() {
    const content = draft.trim();
    if (!content || !chat) return;
    setDraft("");
    const { data, error } = await supabase
      .from("messages")
      .insert({ chat_id: chatId, user_id: userId, sender_type: "user", kind: "text", content })
      .select()
      .single();
    if (error || !data) return;
    addMessage(data as Message);
    setPendingIds((prev) => new Set(prev).add(data.id));
    // Confirmed by the insert round-trip itself.
    setTimeout(() => {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(data.id);
        return next;
      });
    }, 300);
    void conductor.kick();
  }

  if (!chat) {
    return <div className="flex h-full items-center justify-center bg-wa-panel-deep text-wa-text-soft">Loading…</div>;
  }

  const title = chat.type === "dm" ? (chatBots[0]?.name ?? "Deleted bot") : chat.title || chatBots.map((b) => b.name).join(", ") || "Group";
  const headerBot = chat.type === "dm" ? (chatBots[0] ?? null) : null;
  const typingBot = conductor.typingBotId ? botsById.get(conductor.typingBotId) : null;
  const streamingBot = conductor.streaming ? botsById.get(conductor.streaming.botId) : null;
  const lastBotMsgIndex = messages.reduce((acc, m, i) => (m.sender_type === "bot" ? i : acc), -1);
  const invitable = bots.filter((b) => !chatBots.some((cb) => cb.id === b.id));

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center gap-3 border-l border-wa-border bg-wa-panel-deep px-4 py-2">
        {chat.type === "dm" ? <BotAvatar bot={headerBot} size={40} /> : <GroupAvatar size={40} />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-wa-text">{title}</p>
          <p className="truncate text-xs text-wa-text-soft">
            {typingBot
              ? `${typingBot.name} is typing…`
              : streamingBot
                ? `${streamingBot.name} is typing…`
                : chat.type === "group"
                  ? `${chatBots.length} bots`
                  : (headerBot?.model ?? "")}
          </p>
        </div>
        {chat.type === "group" && chatBots.length < 6 && invitable.length > 0 && (
          <button
            onClick={() => setAddBotOpen(true)}
            className="rounded-full p-2 text-wa-text-soft hover:bg-wa-border"
            title="Add bot"
          >
            ➕
          </button>
        )}
        {chat.type === "dm" && chatBots[0] && bots.length > 1 && (
          <button
            onClick={() => setCallPickerOpen(true)}
            className="rounded-full p-2 text-wa-text-soft hover:bg-wa-border"
            title={`Put ${chatBots[0].name} on a call with another bot`}
          >
            📞
          </button>
        )}
      </div>

      {/* messages */}
      <div className="wa-doodle flex-1 overflow-y-auto py-3">
        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const divider = !prev || !sameDay(prev.created_at, msg.created_at);
          const node =
            msg.sender_type === "system" ? (
              <SystemEventPill message={msg} />
            ) : (
              <MessageBubble
                message={msg}
                own={msg.sender_type === "user"}
                bot={msg.bot_id ? botsById.get(msg.bot_id) : null}
                showSender={chat.type === "group" && msg.sender_type === "bot" && shouldShowTail(messages, i)}
                withTail={shouldShowTail(messages, i)}
                checkState={
                  msg.sender_type === "user"
                    ? pendingIds.has(msg.id)
                      ? "pending"
                      : lastBotMsgIndex > i
                        ? "read"
                        : "sent"
                    : undefined
                }
              />
            );
          return (
            <div key={msg.id}>
              {divider && <DateDivider iso={msg.created_at} />}
              {node}
            </div>
          );
        })}
        {conductor.streaming && streamingBot && (
          <MessageBubble
            message={{ content: conductor.streaming.text, created_at: new Date().toISOString() }}
            own={false}
            bot={streamingBot}
            showSender={chat.type === "group"}
            withTail
            streaming
          />
        )}
        {typingBot && !conductor.streaming && <TypingIndicator bot={typingBot} />}
        {conductor.error && (
          <div className="my-2 flex justify-center px-4">
            <span className="max-w-md rounded-lg bg-red-500/10 px-3 py-1.5 text-center text-xs text-red-500">
              {conductor.error}
              {conductor.error.includes("Settings") && (
                <>
                  {" "}
                  <a href="/settings" className="underline">
                    Open settings
                  </a>
                </>
              )}
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* composer */}
      <div className="flex items-end gap-2 bg-wa-panel-deep px-4 py-2.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Type a message"
          className="max-h-32 min-h-[42px] flex-1 resize-none rounded-lg bg-wa-panel px-4 py-2.5 text-wa-text outline-none placeholder:text-wa-text-soft"
        />
        <button
          onClick={() => void send()}
          disabled={!draft.trim()}
          className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-wa-accent text-white transition hover:bg-wa-accent-deep disabled:opacity-40"
          aria-label="Send"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z" />
          </svg>
        </button>
      </div>

      {callPickerOpen && chatBots[0] && (
        <Modal title={`Call: ${chatBots[0].name} + …`} onClose={() => setCallPickerOpen(false)}>
          <p className="mb-2 text-sm text-wa-text-soft">Who should {chatBots[0].name} call?</p>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {bots
              .filter((b) => b.id !== chatBots[0].id)
              .map((b) => (
                <button
                  key={b.id}
                  onClick={async () => {
                    const res = await fetch("/api/calls", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ botA: chatBots[0].id, botB: b.id, chatId }),
                    });
                    const body = await res.json();
                    setCallPickerOpen(false);
                    if (res.ok) router.push(`/calls/${body.call.id}`);
                  }}
                  className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-wa-panel-deep"
                >
                  <BotAvatar bot={b} size={40} />
                  <p className="font-medium text-wa-text">{b.name}</p>
                </button>
              ))}
          </div>
        </Modal>
      )}

      {addBotOpen && (
        <Modal title="Add a bot to the group" onClose={() => setAddBotOpen(false)}>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {invitable.map((b) => (
              <button
                key={b.id}
                onClick={async () => {
                  await fetch(`/api/chats/${chatId}/participants`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ botId: b.id }),
                  });
                  setAddBotOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-wa-panel-deep"
              >
                <BotAvatar bot={b} size={40} />
                <p className="font-medium text-wa-text">{b.name}</p>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
