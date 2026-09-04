import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, jsonError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";

const BodySchema = z.object({ botId: z.string().uuid() });

export async function POST(request: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await ctx.params;
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid request body", 400);

  const admin = createAdminClient();
  const { data: chat } = await admin
    .from("chats")
    .select("id, type")
    .eq("id", chatId)
    .eq("user_id", auth.user.id)
    .single();
  if (!chat) return jsonError("chat not found", 404);
  if (chat.type !== "group") return jsonError("can only add bots to group chats", 400);

  const { data: bot } = await admin
    .from("bots")
    .select("id, name")
    .eq("id", parsed.data.botId)
    .eq("user_id", auth.user.id)
    .single();
  if (!bot) return jsonError("bot not found", 404);

  // Upsert so a bot that previously left the group can rejoin.
  const { error } = await admin
    .from("chat_participants")
    .upsert(
      { chat_id: chatId, bot_id: bot.id, user_id: auth.user.id, left_at: null, joined_at: new Date().toISOString() },
      { onConflict: "chat_id,bot_id" }
    );
  if (error) {
    const message = error.message.includes("at most 6") ? "group chats support at most 6 bots" : error.message;
    return jsonError(message, 409);
  }

  await admin.from("messages").insert({
    chat_id: chatId,
    user_id: auth.user.id,
    sender_type: "system",
    kind: "event",
    content: `${bot.name} was added to the chat`,
  });

  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await ctx.params;
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const botId = new URL(request.url).searchParams.get("botId");
  if (!botId) return jsonError("botId is required", 400);

  const admin = createAdminClient();
  const { data: bot } = await admin
    .from("bots")
    .select("id, name")
    .eq("id", botId)
    .eq("user_id", auth.user.id)
    .single();
  if (!bot) return jsonError("bot not found", 404);

  const { error } = await admin
    .from("chat_participants")
    .update({ left_at: new Date().toISOString() })
    .eq("chat_id", chatId)
    .eq("bot_id", botId)
    .eq("user_id", auth.user.id);
  if (error) return jsonError(error.message, 500);

  await admin.from("messages").insert({
    chat_id: chatId,
    user_id: auth.user.id,
    sender_type: "system",
    kind: "event",
    content: `${bot.name} left the chat`,
  });

  return Response.json({ ok: true });
}
