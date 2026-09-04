import { z } from "zod";
import { requireUser, jsonError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";

const BodySchema = z.object({
  botA: z.string().uuid(),
  botB: z.string().uuid(),
  chatId: z.string().uuid().optional(),
  roundLimit: z.number().int().min(1).max(16).optional(),
});

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid request body", 400);
  const { botA, botB, chatId, roundLimit } = parsed.data;
  if (botA === botB) return jsonError("a bot cannot call itself", 400);

  const admin = createAdminClient();
  const { data: bots } = await admin
    .from("bots")
    .select("id")
    .eq("user_id", auth.user.id)
    .in("id", [botA, botB]);
  if ((bots ?? []).length !== 2) return jsonError("unknown bot", 404);

  const { data: call, error } = await admin
    .from("calls")
    .insert({
      user_id: auth.user.id,
      chat_id: chatId ?? null,
      bot_a: botA,
      bot_b: botB,
      started_by: "user",
      round_limit: roundLimit ?? 8,
    })
    .select()
    .single();
  if (error) return jsonError(error.message, 500);
  return Response.json({ call });
}
