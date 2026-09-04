import type { NextRequest } from "next/server";
import { requireUser, jsonError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { endCall } from "@/lib/orchestrator/summary";
import type { Call } from "@/lib/db/types";

export const maxDuration = 60;

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ callId: string }> }) {
  const { callId } = await ctx.params;
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "end") return jsonError("unsupported action", 400);

  const admin = createAdminClient();
  const { data: call } = (await admin
    .from("calls")
    .select("*")
    .eq("id", callId)
    .eq("user_id", auth.user.id)
    .single()) as { data: Call | null };
  if (!call) return jsonError("call not found", 404);

  const summary = call.status === "active" ? await endCall(admin, call, auth.user.id, "hangup") : call.summary;
  return Response.json({ ok: true, summary });
}
