import { requireUser } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { MODELS, modelSupportsTemperature } from "@/lib/llm/models";
import type { ModelInfo, Provider } from "@/lib/llm/types";

export const maxDuration = 30;

// OpenAI's list is full of non-chat models; keep the conversational ones.
const OPENAI_EXCLUDE =
  /audio|realtime|embed|tts|whisper|dall-e|image|moderation|transcribe|search|instruct|davinci|babbage|codex|computer-use/;
const OPENAI_INCLUDE = /^(gpt-|o[0-9]|chatgpt-)/;

async function anthropicModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  });
  if (!res.ok) throw new Error(`anthropic list failed (${res.status})`);
  const body = (await res.json()) as { data: { id: string; display_name?: string }[] };
  return body.data.map((m) => ({
    id: m.id,
    label: m.display_name ?? m.id,
    provider: "anthropic" as Provider,
    supportsTemperature: modelSupportsTemperature("anthropic", m.id),
  }));
}

async function openaiModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`openai list failed (${res.status})`);
  const body = (await res.json()) as { data: { id: string; created: number }[] };
  return body.data
    .filter((m) => OPENAI_INCLUDE.test(m.id) && !OPENAI_EXCLUDE.test(m.id))
    .sort((a, b) => b.created - a.created)
    .slice(0, 40)
    .map((m) => ({
      id: m.id,
      label: m.id,
      provider: "openai" as Provider,
      supportsTemperature: modelSupportsTemperature("openai", m.id),
    }));
}

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  const { data: keyRows } = await admin
    .from("provider_keys")
    .select("provider, key_ciphertext")
    .eq("user_id", auth.user.id);

  const models: ModelInfo[] = [];
  for (const provider of ["anthropic", "openai"] as Provider[]) {
    const keyRow = keyRows?.find((k) => k.provider === provider);
    if (!keyRow) {
      // No key yet: show the curated defaults so the picker isn't empty.
      models.push(...MODELS.filter((m) => m.provider === provider));
      continue;
    }
    try {
      const apiKey = decryptSecret(keyRow.key_ciphertext);
      models.push(...(provider === "anthropic" ? await anthropicModels(apiKey) : await openaiModels(apiKey)));
    } catch {
      models.push(...MODELS.filter((m) => m.provider === provider));
    }
  }

  return Response.json({ models });
}
