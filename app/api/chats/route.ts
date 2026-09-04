import { z } from "zod";
import { requireUser, jsonError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";

const BodySchema = z.object({
  type: z.enum(["dm", "group"]),
  title: z.string().max(80).optional(),
  botIds: z.array(z.string().uuid()).min(1).max(6),
});

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid request body", 400);
  const { type, title, botIds } = parsed.data;
  if (type === "dm" && botIds.length !== 1) return jsonError("a dm has exactly one bot", 400);

  const admin = createAdminClient();

  const { data: bots, error: botsError } = await admin
    .from("bots")
    .select("id")
    .eq("user_id", auth.user.id)
    .in("id", botIds);
  if (botsError) return jsonError(botsError.message, 500);
  if ((bots ?? []).length !== botIds.length) return jsonError("unknown bot", 404);

  const { data: chat, error: chatError } = await admin
    .from("chats")
    .insert({ user_id: auth.user.id, type, title: title ?? null })
    .select()
    .single();
  if (chatError) return jsonError(chatError.message, 500);

  const { error: partError } = await admin.from("chat_participants").insert(
    botIds.map((botId) => ({ chat_id: chat.id, bot_id: botId, user_id: auth.user.id }))
  );
  if (partError) {
    await admin.from("chats").delete().eq("id", chat.id);
    return jsonError(partError.message, 500);
  }

  return Response.json({ chat });
}
