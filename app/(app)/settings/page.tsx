"use client";

import { useState } from "react";
import Link from "next/link";
import { useAppData } from "@/components/providers/AppData";
import type { Provider } from "@/lib/llm/types";

const PROVIDERS: { id: Provider; label: string; placeholder: string; note: string }[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    placeholder: "sk-ant-…",
    note: "Powers Claude models. Get a key at console.anthropic.com.",
  },
  {
    id: "openai",
    label: "OpenAI",
    placeholder: "sk-…",
    note: "Powers GPT models. Get a key at platform.openai.com.",
  },
];

export default function SettingsPage() {
  const { keys, refresh } = useAppData();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { ok: boolean; text: string }>>({});

  async function save(provider: Provider) {
    const apiKey = drafts[provider]?.trim();
    if (!apiKey) return;
    setBusy(provider);
    setMessages((m) => {
      const next = { ...m };
      delete next[provider];
      return next;
    });
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "failed to save key");
      setDrafts((d) => ({ ...d, [provider]: "" }));
      setMessages((m) => ({ ...m, [provider]: { ok: true, text: "Key saved and verified." } }));
      await refresh();
    } catch (err) {
      setMessages((m) => ({
        ...m,
        [provider]: { ok: false, text: err instanceof Error ? err.message : "failed" },
      }));
    } finally {
      setBusy(null);
    }
  }

  async function remove(provider: Provider) {
    setBusy(provider);
    await fetch(`/api/keys?provider=${provider}`, { method: "DELETE" });
    await refresh();
    setBusy(null);
  }

  return (
    <div className="h-full overflow-y-auto bg-wa-panel-deep">
      <div className="mx-auto max-w-xl px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/" className="rounded-full p-2 text-wa-text-soft hover:bg-wa-border" aria-label="Back">
            ←
          </Link>
          <h1 className="text-xl font-semibold text-wa-text">Settings</h1>
        </div>

        <section className="rounded-lg bg-wa-panel p-6 shadow-sm">
          <h2 className="mb-1 font-medium text-wa-text">API keys</h2>
          <p className="mb-4 text-sm text-wa-text-soft">
            One key per provider. Keys are encrypted on the server and never sent to your browser — only the
            last four characters are shown.
          </p>
          <div className="space-y-6">
            {PROVIDERS.map((p) => {
              const saved = keys.find((k) => k.provider === p.id);
              const msg = messages[p.id];
              return (
                <div key={p.id}>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="font-medium text-wa-text">{p.label}</p>
                    {saved && (
                      <span className="rounded-full bg-wa-accent/10 px-2 py-0.5 text-xs text-wa-accent">
                        saved ····{saved.key_hint}
                      </span>
                    )}
                  </div>
                  <p className="mb-2 text-xs text-wa-text-soft">{p.note}</p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={drafts[p.id] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                      placeholder={saved ? `replace key (····${saved.key_hint})` : p.placeholder}
                      className="flex-1 rounded-md border border-wa-border bg-wa-panel-deep px-3 py-2 text-sm text-wa-text outline-none focus:border-wa-accent"
                    />
                    <button
                      onClick={() => void save(p.id)}
                      disabled={busy === p.id || !drafts[p.id]?.trim()}
                      className="rounded-md bg-wa-accent px-4 py-2 text-sm font-medium text-white hover:bg-wa-accent-deep disabled:opacity-40"
                    >
                      {busy === p.id ? "…" : "Save"}
                    </button>
                    {saved && (
                      <button
                        onClick={() => void remove(p.id)}
                        disabled={busy === p.id}
                        className="rounded-md border border-wa-border px-3 py-2 text-sm text-red-500 hover:bg-wa-panel-deep"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {msg && (
                    <p className={`mt-1 text-xs ${msg.ok ? "text-wa-accent" : "text-red-500"}`}>{msg.text}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
