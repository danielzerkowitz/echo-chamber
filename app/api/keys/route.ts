import { z } from "zod";
import { requireUser, jsonError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";

const BodySchema = z.object({
  provider: z.enum(["anthropic", "openai"]),
  apiKey: z.string().min(10).max(500),
});

async function validateKey(provider: "anthropic" | "openai", apiKey: string): Promise<string | null> {
  try {
    const res =
      provider === "anthropic"
        ? await fetch("https://api.anthropic.com/v1/models?limit=1", {
            headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          })
        : await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
    if (res.status === 401 || res.status === 403) return "the provider rejected this API key";
    return null;
  } catch {
    // Network hiccup — don't block saving on a validation ping.
    return null;
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid request body", 400);
  const { provider, apiKey } = parsed.data;

  const invalid = await validateKey(provider, apiKey);
  if (invalid) return jsonError(invalid, 422);

  const admin = createAdminClient();
  const { error } = await admin.from("provider_keys").upsert(
    {
      user_id: auth.user.id,
      provider,
      key_ciphertext: encryptSecret(apiKey),
      key_hint: apiKey.slice(-4),
    },
    { onConflict: "user_id,provider" }
  );
  if (error) return jsonError(error.message, 500);
  return Response.json({ ok: true, provider, keyHint: apiKey.slice(-4) });
}

export async function DELETE(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const provider = new URL(request.url).searchParams.get("provider");
  if (provider !== "anthropic" && provider !== "openai") return jsonError("invalid provider", 400);

  const admin = createAdminClient();
  const { error } = await admin
    .from("provider_keys")
    .delete()
    .eq("user_id", auth.user.id)
    .eq("provider", provider);
  if (error) return jsonError(error.message, 500);
  return Response.json({ ok: true });
}
