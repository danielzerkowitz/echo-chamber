"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useAppData } from "@/components/providers/AppData";
import { MODELS } from "@/lib/llm/models";
import type { Bot } from "@/lib/db/types";
import type { Provider } from "@/lib/llm/types";

const EMOJI_CHOICES = ["🤖", "🧠", "👻", "🦊", "🐙", "🦉", "🐸", "🌵", "🔥", "🎩", "🧙", "👾", "🍕", "🎸", "☕", "🚀"];
const COLOR_CHOICES = ["#00a884", "#53bdeb", "#a791f5", "#f5a97f", "#ed8796", "#eed49f", "#7dc4e4", "#8bd5ca"];

export function BotEditor({ bot, onClose }: { bot: Bot | null; onClose: () => void }) {
  const { supabase, userId, keys, refresh } = useAppData();
  const [name, setName] = useState(bot?.name ?? "");
  const [emoji, setEmoji] = useState(bot?.avatar_emoji ?? "🤖");
  const [color, setColor] = useState(bot?.avatar_color ?? "#00a884");
  const [persona, setPersona] = useState(bot?.persona ?? "");
  const [modelId, setModelId] = useState(bot?.model ?? "claude-opus-5");
  const [temperature, setTemperature] = useState<string>(bot?.temperature?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0];
  const providersWithKey = new Set(keys.map((k) => k.provider));

  async function save() {
    if (!name.trim()) {
      setError("give the bot a name");
      return;
    }
    setBusy(true);
    setError(null);
    const row = {
      user_id: userId,
      name: name.trim(),
      avatar_emoji: emoji,
      avatar_color: color,
      persona,
      provider: model.provider as Provider,
      model: model.id,
      temperature: model.supportsTemperature && temperature !== "" ? Number(temperature) : null,
      updated_at: new Date().toISOString(),
    };
    const query = bot
      ? supabase.from("bots").update(row).eq("id", bot.id)
      : supabase.from("bots").insert(row);
    const { error: dbError } = await query;
    setBusy(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    await refresh();
    onClose();
  }

  async function remove() {
    if (!bot) return;
    if (!confirm(`Delete ${bot.name}? Their messages stay in your chats.`)) return;
    setBusy(true);
    await supabase.from("bots").delete().eq("id", bot.id);
    await refresh();
    onClose();
  }

  return (
    <Modal title={bot ? `Edit ${bot.name}` : "New bot"} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full text-3xl"
            style={{ backgroundColor: color }}
          >
            {emoji}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bot name"
            maxLength={60}
            className="flex-1 rounded-md border border-wa-border bg-wa-panel-deep px-3 py-2 text-wa-text outline-none focus:border-wa-accent"
          />
        </div>

        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-wa-text-soft">Avatar</p>
          <div className="flex flex-wrap gap-1">
            {EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={`rounded p-1.5 text-xl hover:bg-wa-panel-deep ${e === emoji ? "bg-wa-panel-deep ring-2 ring-wa-accent" : ""}`}
              >
                {e}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            {COLOR_CHOICES.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full ${c === color ? "ring-2 ring-wa-text ring-offset-2 ring-offset-wa-panel" : ""}`}
                style={{ backgroundColor: c }}
                aria-label={`color ${c}`}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-wa-text-soft">Persona</p>
          <textarea
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            rows={4}
            placeholder="Who is this bot? Their personality, expertise, quirks, how they talk…"
            className="w-full rounded-md border border-wa-border bg-wa-panel-deep px-3 py-2 text-sm text-wa-text outline-none focus:border-wa-accent"
          />
        </div>

        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-wa-text-soft">Model</p>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="w-full rounded-md border border-wa-border bg-wa-panel-deep px-3 py-2 text-wa-text outline-none focus:border-wa-accent"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.provider})
              </option>
            ))}
          </select>
          {!providersWithKey.has(model.provider) && (
            <p className="mt-1 text-xs text-amber-500">
              No {model.provider} API key saved yet — add one in Settings before chatting.
            </p>
          )}
        </div>

        {model.supportsTemperature && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-wa-text-soft">
              Temperature (optional, 0–2)
            </p>
            <input
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              type="number"
              min={0}
              max={2}
              step={0.1}
              placeholder="model default"
              className="w-full rounded-md border border-wa-border bg-wa-panel-deep px-3 py-2 text-wa-text outline-none focus:border-wa-accent"
            />
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex justify-between pt-2">
          {bot ? (
            <button onClick={remove} disabled={busy} className="text-sm text-red-500 hover:underline">
              Delete bot
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={save}
            disabled={busy}
            className="rounded-md bg-wa-accent px-4 py-2 font-medium text-white hover:bg-wa-accent-deep disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
