"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useAppData } from "@/components/providers/AppData";
import { BotAvatar } from "@/components/bots/BotAvatar";

type Mode = "dm" | "group" | "call";

export function NewChatModal({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const { bots, refresh } = useAppData();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const max = mode === "dm" ? 1 : mode === "call" ? 2 : 6;
  const min = mode === "dm" ? 1 : 2;

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (mode === "dm") return [id];
      if (prev.length >= max) return prev;
      return [...prev, id];
    });
  }

  async function create() {
    if (selected.length < min) {
      setError(mode === "dm" ? "pick a bot" : `pick at least ${min} bots`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "call") {
        const res = await fetch("/api/calls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ botA: selected[0], botB: selected[1] }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "failed to start call");
        router.push(`/calls/${body.call.id}`);
      } else {
        const res = await fetch("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: mode,
            botIds: selected,
            ...(mode === "group" && title.trim() ? { title: title.trim() } : {}),
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "failed to create chat");
        await refresh();
        router.push(`/chats/${body.chat.id}`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
      setBusy(false);
    }
  }

  const titles: Record<Mode, string> = {
    dm: "New chat",
    group: "New group",
    call: "Start a call",
  };

  return (
    <Modal title={titles[mode]} onClose={onClose}>
      {bots.length === 0 ? (
        <p className="text-sm text-wa-text-soft">Create a bot first — use the ➕ menu.</p>
      ) : (
        <div className="space-y-4">
          {mode === "group" && (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Group name (optional)"
              maxLength={80}
              className="w-full rounded-md border border-wa-border bg-wa-panel-deep px-3 py-2 text-wa-text outline-none focus:border-wa-accent"
            />
          )}
          {mode === "call" && (
            <p className="text-sm text-wa-text-soft">Pick two bots — they&apos;ll talk live, and you can chime in.</p>
          )}
          {mode === "group" && (
            <p className="text-sm text-wa-text-soft">Pick 2–6 bots ({selected.length} selected).</p>
          )}
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {bots.map((bot) => (
              <button
                key={bot.id}
                onClick={() => toggle(bot.id)}
                className={`flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-wa-panel-deep ${
                  selected.includes(bot.id) ? "bg-wa-panel-deep" : ""
                }`}
              >
                <BotAvatar bot={bot} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-wa-text">{bot.name}</p>
                  <p className="truncate text-xs text-wa-text-soft">{bot.model}</p>
                </div>
                {selected.includes(bot.id) && <span className="text-wa-accent">✓</span>}
              </button>
            ))}
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            onClick={create}
            disabled={busy}
            className="w-full rounded-md bg-wa-accent py-2 font-medium text-white hover:bg-wa-accent-deep disabled:opacity-50"
          >
            {busy ? "…" : mode === "call" ? "📞 Start call" : "Create"}
          </button>
        </div>
      )}
    </Modal>
  );
}
