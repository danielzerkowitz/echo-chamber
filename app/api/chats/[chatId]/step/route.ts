import type { NextRequest } from "next/server";
import { requireUser, jsonError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { sseResponse, type SseEvent } from "@/lib/sse";
import { streamChat } from "@/lib/llm";
import { STAY_SILENT, CALL_BOT, INVITE_BOT } from "@/lib/orchestrator/tools";
import { buildSystemPrompt, historyToTurns } from "@/lib/orchestrator/prompt";
import {
  startRound,
  advanceRound,
  nextBotId,
  isReactionPass,
  lockExpired,
  LOCK_TTL_MS,
} from "@/lib/orchestrator/round";
import type { Bot, Chat, Message, RoundState } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 300;

const BOT_MAX_TOKENS = 1024;

async function claimRound(
  admin: SupabaseClient,
  chatId: string,
  expectedVersion: number,
  state: RoundState
): Promise<boolean> {
  const locked: RoundState = {
    ...state,
    version: expectedVersion + 1,
    locked_until: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
  };
  const { data, error } = await admin
    .from("chats")
    .update({ round: locked })
    .eq("id", chatId)
    .eq("round->>version", String(expectedVersion))
    .select("id");
  return !error && (data ?? []).length > 0;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await ctx.params;
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const userId = auth.user.id;
  const admin = createAdminClient();

  const { data: chat } = (await admin
    .from("chats")
    .select("*")
    .eq("id", chatId)
    .eq("user_id", userId)
    .single()) as { data: Chat | null };
  if (!chat) return jsonError("chat not found", 404);

  const [{ data: participants }, { data: allBots }, { data: messages }] = await Promise.all([
    admin.from("chat_participants").select("*").eq("chat_id", chatId).is("left_at", null),
    admin.from("bots").select("*").eq("user_id", userId),
    admin.from("messages").select("*").eq("chat_id", chatId).order("created_at", { ascending: false }).limit(200),
  ]);
  const bots = (allBots ?? []) as Bot[];
  const botsById = new Map(bots.map((b) => [b.id, b]));
  const participantIds = (participants ?? [])
    .map((p) => p.bot_id as string)
    .filter((id) => botsById.has(id));
  const history = ((messages ?? []) as Message[]).reverse(); // fetched newest-first

  // Work out the round state for this step.
  let round = chat.round;
  if (round.status === "active" && !lockExpired(round)) {
    return Response.json({ error: "round is locked", retryAfter: 3 }, { status: 409 });
  }
  // Drop queued bots that no longer exist or left the chat (e.g. deleted mid-round).
  if (round.queue) {
    round = { ...round, queue: round.queue.filter((id) => participantIds.includes(id)) };
    if (round.status === "active" && round.queue!.length === 0) {
      round = { status: "idle", version: round.version };
    }
  }
  if (round.status === "idle") {
    const last = history[history.length - 1];
    if (!last || last.sender_type !== "user") {
      return Response.json({ round: { complete: true } });
    }
    round = startRound(round, participantIds, last.id);
    round.version = chat.round.version; // claimRound bumps it
  }

  const botId = nextBotId({ ...round, status: "active" });
  if (!botId) {
    // Degenerate state (e.g. all participants deleted); reset to idle.
    await admin
      .from("chats")
      .update({ round: { status: "idle", version: chat.round.version + 1 } })
      .eq("id", chatId);
    return Response.json({ round: { complete: true } });
  }
  const bot = botsById.get(botId)!;

  const claimed = await claimRound(admin, chatId, chat.round.version, round);
  if (!claimed) {
    return Response.json({ error: "round is locked", retryAfter: 3 }, { status: 409 });
  }
  const claimedVersion = chat.round.version + 1;
  round = { ...round, version: claimedVersion };

  const { data: keyRow } = await admin
    .from("provider_keys")
    .select("key_ciphertext")
    .eq("user_id", userId)
    .eq("provider", bot.provider)
    .single();
  if (!keyRow) {
    await admin
      .from("chats")
      .update({ round: { status: "idle", version: claimedVersion + 1 } })
      .eq("id", chatId);
    return jsonError(`no ${bot.provider} API key configured — add one in Settings`, 422);
  }
  const apiKey = decryptSecret(keyRow.key_ciphertext);

  const isGroup = chat.type === "group";
  const chatBots = participantIds.map((id) => botsById.get(id)!).filter(Boolean);
  const invitable = bots.filter((b) => !participantIds.includes(b.id));
  const callable = bots.filter((b) => b.id !== bot.id);

  const tools = [
    ...(isGroup ? [STAY_SILENT] : []),
    ...(callable.length > 0 ? [CALL_BOT] : []),
    ...(isGroup && invitable.length > 0 ? [INVITE_BOT] : []),
  ];

  const system = buildSystemPrompt({
    bot,
    participants: chatBots.filter((b) => b.id !== bot.id),
    chatType: chat.type,
    reactionPass: isReactionPass(round),
    callableBots: callable,
    invitableBots: invitable,
  });
  const turns = historyToTurns(history, bot.id, botsById);

  return sseResponse(async (emit) => {
    emit({ type: "turn_start", botId: bot.id });

    let text = "";
    let failed = false;
    const toolEvents: SseEvent[] = [];

    const inserts: Array<Partial<Message>> = [];

    for await (const event of streamChat({
      provider: bot.provider,
      model: bot.model,
      apiKey,
      system,
      messages: turns,
      tools,
      temperature: bot.temperature,
      maxTokens: BOT_MAX_TOKENS,
    })) {
      if (event.type === "text_delta") {
        text += event.text;
        emit({ type: "delta", text: event.text });
      } else if (event.type === "tool_call") {
        if (event.name === "stay_silent") {
          // Acknowledged; whether the turn is silent is decided by the text below.
        } else if (event.name === "call_bot" || event.name === "invite_bot") {
          const requestedName = String(event.input.bot_name ?? "");
          // Resolve within the subset the tool is allowed to target; prefer an
          // exact-case match when names collide.
          const pool = event.name === "call_bot" ? callable : invitable;
          const target =
            pool.find((b) => b.name === requestedName) ??
            pool.find((b) => b.name.toLowerCase() === requestedName.toLowerCase());
          if (!target) {
            // Surface the failure instead of silently dropping it.
            inserts.push({
              sender_type: "system",
              kind: "event",
              content: `${bot.name} tried to reach "${requestedName}", but no such bot is available`,
            });
            continue;
          }
          if (event.name === "call_bot" && target.id !== bot.id) {
            const { data: call } = await admin
              .from("calls")
              .insert({
                user_id: userId,
                chat_id: chatId,
                bot_a: bot.id,
                bot_b: target.id,
                started_by: "bot",
              })
              .select()
              .single();
            if (call) {
              inserts.push({
                sender_type: "system",
                kind: "event",
                content: `${bot.name} started a call with ${target.name}`,
                metadata: { callId: call.id },
              });
              toolEvents.push({ type: "tool", name: "call_bot", args: event.input, callId: call.id });
            }
          } else if (event.name === "invite_bot" && !participantIds.includes(target.id)) {
            // Upsert so a bot that previously left can rejoin.
            const { error: inviteError } = await admin
              .from("chat_participants")
              .upsert(
                { chat_id: chatId, bot_id: target.id, user_id: userId, left_at: null, joined_at: new Date().toISOString() },
                { onConflict: "chat_id,bot_id" }
              );
            if (!inviteError) {
              inserts.push({
                sender_type: "system",
                kind: "event",
                content: `${bot.name} added ${target.name} to the chat`,
              });
              toolEvents.push({ type: "tool", name: "invite_bot", args: event.input });
            }
          }
        }
      } else if (event.type === "error") {
        failed = true;
        emit({ type: "error", message: event.message, retryable: true });
      }
    }

    if (failed) {
      // Unlock but keep the round where it was so the user can retry.
      await admin
        .from("chats")
        .update({ round: { ...round, version: claimedVersion + 1, locked_until: null } })
        .eq("id", chatId);
      return;
    }

    // Silence = the stay_silent tool with no text, empty output, or an explicit
    // sentinel. If the model streamed real text AND called stay_silent, keep the
    // text — the user already watched it render.
    const trimmed = text.trim();
    const spokeText = trimmed.length > 0 && trimmed !== "[SILENT]";

    let messageId: string | undefined;
    if (spokeText) {
      const { data: inserted } = await admin
        .from("messages")
        .insert({
          chat_id: chatId,
          user_id: userId,
          sender_type: "bot",
          bot_id: bot.id,
          kind: "text",
          content: trimmed,
        })
        .select("id")
        .single();
      messageId = inserted?.id;
    }
    for (const extra of inserts) {
      await admin.from("messages").insert({ chat_id: chatId, user_id: userId, content: "", ...extra });
    }
    if (spokeText || inserts.length > 0) {
      await admin.from("chats").update({ last_message_at: new Date().toISOString() }).eq("id", chatId);
    }

    for (const toolEvent of toolEvents) emit(toolEvent);

    const spoke = spokeText || inserts.length > 0;
    const next = advanceRound({ ...round, version: claimedVersion }, { botId: bot.id, spoke }, participantIds);
    await admin.from("chats").update({ round: next }).eq("id", chatId);

    emit({ type: "turn_end", messageId, silent: !spokeText });
    emit({ type: "round", complete: next.status === "idle", nextBotId: nextBotId(next) });
  });
}
