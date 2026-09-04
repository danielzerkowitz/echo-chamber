import type { NextRequest } from "next/server";
import { requireUser, jsonError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { sseResponse } from "@/lib/sse";
import { streamChat } from "@/lib/llm";
import { buildCallSystemPrompt, callHistoryToTurns } from "@/lib/orchestrator/prompt";
import { LOCK_TTL_MS } from "@/lib/orchestrator/round";
import { endCall } from "@/lib/orchestrator/summary";
import type { Bot, Call, CallMessage } from "@/lib/db/types";

export const maxDuration = 300;

const CALL_MAX_TOKENS = 512;

export async function POST(request: NextRequest, ctx: { params: Promise<{ callId: string }> }) {
  const { callId } = await ctx.params;
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const userId = auth.user.id;
  const admin = createAdminClient();

  const { data: call } = (await admin
    .from("calls")
    .select("*")
    .eq("id", callId)
    .eq("user_id", userId)
    .single()) as { data: Call | null };
  if (!call) return jsonError("call not found", 404);
  if (call.status !== "active") return Response.json({ round: { complete: true } });

  const maxUtterances = call.round_limit * 2;
  if (call.rounds_used >= maxUtterances) {
    await endCall(admin, call, userId, "limit");
    return Response.json({ round: { complete: true } });
  }

  // Claim the call so two tabs can't run duplicate turns: compare-and-swap on
  // locked_until (stealable once expired, in case a function died mid-turn).
  const nowIso = new Date().toISOString();
  const lockIso = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  const { data: claimed } = await admin
    .from("calls")
    .update({ locked_until: lockIso })
    .eq("id", callId)
    .eq("status", "active")
    .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
    .select("id, rounds_used");
  if (!claimed || claimed.length === 0) {
    return Response.json({ error: "call is busy", retryAfter: 3 }, { status: 409 });
  }
  // Re-read progress under the lock (another tab may have stepped since our read).
  call.rounds_used = claimed[0].rounds_used;
  if (call.rounds_used >= maxUtterances) {
    await admin.from("calls").update({ locked_until: null }).eq("id", callId);
    await endCall(admin, call, userId, "limit");
    return Response.json({ round: { complete: true } });
  }

  const [{ data: botRows }, { data: messageRows }] = await Promise.all([
    admin.from("bots").select("*").in("id", [call.bot_a, call.bot_b]),
    admin.from("call_messages").select("*").eq("call_id", callId).order("created_at", { ascending: true }),
  ]);
  const bots = (botRows ?? []) as Bot[];
  const botA = bots.find((b) => b.id === call.bot_a);
  const botB = bots.find((b) => b.id === call.bot_b);
  if (!botA || !botB) return jsonError("call participants missing", 404);
  const history = (messageRows ?? []) as CallMessage[];

  // Strict alternation: the bot who didn't speak last goes next (caller opens).
  const lastBotMsg = [...history].reverse().find((m) => m.sender_type === "bot");
  const speaker = !lastBotMsg ? botA : lastBotMsg.bot_id === botA.id ? botB : botA;
  const other = speaker.id === botA.id ? botB : botA;

  const { data: keyRow } = await admin
    .from("provider_keys")
    .select("key_ciphertext")
    .eq("user_id", userId)
    .eq("provider", speaker.provider)
    .single();
  if (!keyRow) return jsonError(`no ${speaker.provider} API key configured — add one in Settings`, 422);
  const apiKey = decryptSecret(keyRow.key_ciphertext);

  const botsById = new Map(bots.map((b) => [b.id, b]));
  const system = buildCallSystemPrompt({ bot: speaker, otherBot: other });
  const turns = callHistoryToTurns(history, speaker.id, botsById);
  if (history.length === 0) {
    turns[turns.length - 1].content += `\n[system]: You called ${other.name}. Open the conversation and say why you're calling.`;
  }

  return sseResponse(async (emit) => {
    emit({ type: "turn_start", botId: speaker.id });

    let text = "";
    let failed = false;
    for await (const event of streamChat({
      provider: speaker.provider,
      model: speaker.model,
      apiKey,
      system,
      messages: turns,
      temperature: speaker.temperature,
      maxTokens: CALL_MAX_TOKENS,
    })) {
      if (event.type === "text_delta") {
        text += event.text;
        emit({ type: "delta", text: event.text });
      } else if (event.type === "error") {
        failed = true;
        emit({ type: "error", message: event.message, retryable: true });
      }
    }
    if (failed) {
      await admin.from("calls").update({ locked_until: null }).eq("id", callId);
      return;
    }

    const trimmed = text.trim();
    let messageId: string | undefined;
    if (trimmed) {
      const { data: inserted } = await admin
        .from("call_messages")
        .insert({
          call_id: callId,
          user_id: userId,
          sender_type: "bot",
          bot_id: speaker.id,
          content: trimmed,
        })
        .select("id")
        .single();
      messageId = inserted?.id;
    }

    const used = call.rounds_used + 1;
    await admin.from("calls").update({ rounds_used: used, locked_until: null }).eq("id", callId);

    const complete = used >= maxUtterances;
    if (complete) {
      await endCall(admin, { ...call, rounds_used: used }, userId, "limit");
    }

    emit({ type: "turn_end", messageId, silent: !trimmed });
    emit({ type: "round", complete, nextBotId: complete ? null : other.id });
  });
}
