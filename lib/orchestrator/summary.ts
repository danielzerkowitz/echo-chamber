import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { completeText, UTILITY_MODEL } from "@/lib/llm";
import type { Bot, Call, CallMessage } from "@/lib/db/types";

// End a call: mark it ended, write a short summary with a cheap model, and
// post a call-log message into the originating chat (if any).
export async function endCall(
  admin: SupabaseClient,
  call: Call,
  userId: string,
  reason: "hangup" | "limit"
): Promise<string | null> {
  const { data: updated } = await admin
    .from("calls")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", call.id)
    .eq("status", "active")
    .select("id");
  if ((updated ?? []).length === 0) return null; // already ended

  const [{ data: botRows }, { data: messageRows }, { data: keyRows }] = await Promise.all([
    admin.from("bots").select("*").in("id", [call.bot_a, call.bot_b]),
    admin.from("call_messages").select("*").eq("call_id", call.id).order("created_at", { ascending: true }),
    admin.from("provider_keys").select("provider, key_ciphertext").eq("user_id", userId),
  ]);
  const bots = (botRows ?? []) as Bot[];
  const messages = (messageRows ?? []) as CallMessage[];
  const botA = bots.find((b) => b.id === call.bot_a);
  const botB = bots.find((b) => b.id === call.bot_b);

  let summary: string | null = null;
  const keyRow = keyRows?.[0];
  if (keyRow && messages.length > 0 && botA && botB) {
    try {
      const transcript = messages
        .map((m) => {
          const who =
            m.sender_type === "user" ? "User" : m.bot_id === botA.id ? botA.name : botB.name;
          return `${who}: ${m.content}`;
        })
        .join("\n");
      summary = await completeText({
        provider: keyRow.provider,
        model: UTILITY_MODEL[keyRow.provider as "anthropic" | "openai"],
        apiKey: decryptSecret(keyRow.key_ciphertext),
        system: "Summarize this call transcript in at most 2 short sentences. Plain text, no preamble.",
        messages: [{ role: "user", content: transcript }],
        maxTokens: 200,
      });
      await admin.from("calls").update({ summary }).eq("id", call.id);
    } catch {
      summary = null;
    }
  }

  if (call.chat_id && botA && botB) {
    const durationLine = reason === "limit" ? "Call ended (round limit reached)" : "Call ended";
    await admin.from("messages").insert({
      chat_id: call.chat_id,
      user_id: userId,
      sender_type: "system",
      kind: "call_summary",
      content: summary
        ? `📞 ${botA.name} ↔ ${botB.name} — ${summary}`
        : `📞 ${botA.name} ↔ ${botB.name} — ${durationLine}`,
      metadata: { callId: call.id },
    });
    await admin.from("chats").update({ last_message_at: new Date().toISOString() }).eq("id", call.chat_id);
  }

  return summary;
}
