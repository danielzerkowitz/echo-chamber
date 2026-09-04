"use client";

import Link from "next/link";
import { BotAvatar } from "@/components/bots/BotAvatar";
import { formatClock, formatDayDivider, sameDay } from "@/lib/format";
import type { Bot, Message } from "@/lib/db/types";

export function DateDivider({ iso }: { iso: string }) {
  return (
    <div className="my-3 flex justify-center">
      <span className="rounded-lg bg-wa-panel px-3 py-1 text-xs text-wa-text-soft shadow-sm">
        {formatDayDivider(iso)}
      </span>
    </div>
  );
}

export function SystemEventPill({ message }: { message: Message }) {
  const callId = message.metadata?.callId as string | undefined;
  if (message.kind === "call_summary") {
    return (
      <div className="my-2 flex justify-center px-4">
        <Link
          href={callId ? `/calls/${callId}` : "#"}
          className="max-w-md rounded-lg bg-wa-panel px-4 py-2 text-sm text-wa-text shadow-sm hover:bg-wa-panel-deep"
        >
          {message.content}
          <span className="mt-0.5 block text-xs text-wa-text-soft">
            {formatClock(message.created_at)} · tap to view transcript
          </span>
        </Link>
      </div>
    );
  }
  return (
    <div className="my-2 flex justify-center">
      <span className="rounded-lg bg-wa-panel px-3 py-1 text-xs text-wa-text-soft shadow-sm">
        {callId ? (
          <Link href={`/calls/${callId}`} className="hover:underline">
            📞 {message.content}
          </Link>
        ) : (
          message.content
        )}
      </span>
    </div>
  );
}

export function Checkmarks({ state }: { state: "pending" | "sent" | "read" }) {
  if (state === "pending") {
    return <span className="text-xs text-wa-text-soft">✓</span>;
  }
  return (
    <span className={`text-xs ${state === "read" ? "text-wa-check" : "text-wa-text-soft"}`}>✓✓</span>
  );
}

interface BubbleProps {
  message: Pick<Message, "content" | "created_at">;
  own: boolean;
  bot?: Bot | null;
  showSender: boolean;
  withTail: boolean;
  checkState?: "pending" | "sent" | "read";
  streaming?: boolean;
}

export function MessageBubble({ message, own, bot, showSender, withTail, checkState, streaming }: BubbleProps) {
  return (
    <div className={`flex px-4 py-0.5 ${own ? "justify-end" : "justify-start"}`}>
      {!own && (
        <div className="mr-2 w-8 shrink-0 self-end">
          {withTail && bot ? <BotAvatar bot={bot} size={32} /> : null}
        </div>
      )}
      <div
        className={`relative max-w-[72%] rounded-lg px-3 py-1.5 shadow-sm ${
          own ? "bg-wa-bubble-out" : "bg-wa-bubble-in"
        } ${withTail ? (own ? "bubble-out rounded-tr-none" : "bubble-in rounded-tl-none") : ""}`}
      >
        {showSender && bot && (
          <p className="mb-0.5 text-xs font-semibold" style={{ color: bot.avatar_color }}>
            {bot.name}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words text-wa-text">
          {message.content}
          {streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-wa-text-soft align-middle" />}
        </p>
        <div className="mt-0.5 flex items-center justify-end gap-1">
          <span className="text-[11px] text-wa-text-soft">{formatClock(message.created_at)}</span>
          {own && checkState && <Checkmarks state={checkState} />}
        </div>
      </div>
    </div>
  );
}

export function TypingIndicator({ bot }: { bot: Bot }) {
  return (
    <div className="flex px-4 py-0.5">
      <div className="mr-2 w-8 shrink-0 self-end">
        <BotAvatar bot={bot} size={32} />
      </div>
      <div className="bubble-in relative rounded-lg rounded-tl-none bg-wa-bubble-in px-4 py-3 shadow-sm">
        <div className="flex gap-1">
          <span className="typing-dot h-2 w-2 rounded-full bg-wa-text-soft" />
          <span className="typing-dot h-2 w-2 rounded-full bg-wa-text-soft" />
          <span className="typing-dot h-2 w-2 rounded-full bg-wa-text-soft" />
        </div>
      </div>
    </div>
  );
}

// Group consecutive messages and interleave day dividers.
export function shouldShowTail(messages: Message[], index: number): boolean {
  const msg = messages[index];
  const prev = messages[index - 1];
  if (!prev) return true;
  if (!sameDay(prev.created_at, msg.created_at)) return true;
  return prev.sender_type !== msg.sender_type || prev.bot_id !== msg.bot_id || prev.kind !== "text";
}
