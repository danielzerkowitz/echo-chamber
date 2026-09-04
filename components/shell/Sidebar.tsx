"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAppData } from "@/components/providers/AppData";
import { BotAvatar, GroupAvatar } from "@/components/bots/BotAvatar";
import { BotEditor } from "@/components/bots/BotEditor";
import { NewChatModal } from "@/components/bots/NewChatModal";
import { createClient } from "@/lib/supabase/client";
import { formatListTime } from "@/lib/format";
import type { Bot, Chat } from "@/lib/db/types";

function chatDisplay(chat: Chat, chatBots: Bot[]): { name: string; bot: Bot | null } {
  if (chat.type === "dm") {
    const bot = chatBots[0] ?? null;
    return { name: bot?.name ?? "Deleted bot", bot };
  }
  return {
    name: chat.title || chatBots.map((b) => b.name).join(", ") || "Group",
    bot: null,
  };
}

export function Sidebar() {
  const { bots, chats, participants, previews } = useAppData();
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState<"new" | "kebab" | null>(null);
  const [modal, setModal] = useState<"bot" | "dm" | "group" | "call" | null>(null);
  const [editBot, setEditBot] = useState<Bot | null>(null);

  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const botsByChat = useMemo(() => {
    const map = new Map<string, Bot[]>();
    for (const p of participants) {
      const bot = botsById.get(p.bot_id);
      if (!bot) continue;
      map.set(p.chat_id, [...(map.get(p.chat_id) ?? []), bot]);
    }
    return map;
  }, [participants, botsById]);

  const filtered = chats.filter((chat) => {
    if (!search.trim()) return true;
    const { name } = chatDisplay(chat, botsByChat.get(chat.id) ?? []);
    return name.toLowerCase().includes(search.toLowerCase());
  });

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function toggleTheme() {
    const isDark = document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("theme", isDark ? "dark" : "light");
    } catch {}
    setMenuOpen(null);
  }

  return (
    <aside className="flex h-full w-full max-w-[420px] flex-col border-r border-wa-border bg-wa-panel">
      {/* header */}
      <div className="flex items-center justify-between bg-wa-panel-deep px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-2xl">💬</span>
          <span className="font-semibold text-wa-text">Echo Chamber</span>
        </div>
        <div className="relative flex items-center gap-1">
          <button
            onClick={() => setMenuOpen(menuOpen === "new" ? null : "new")}
            className="rounded-full p-2 text-wa-text-soft hover:bg-wa-border"
            title="New"
            aria-label="New"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M19.005 3.175H4.674C3.642 3.175 3 3.789 3 4.821V21.02l3.544-3.514h12.461c1.033 0 2.064-1.06 2.064-2.093V4.821c-.001-1.032-1.032-1.646-2.064-1.646zm-4.989 9.869H7.041V11.1h6.975v1.944zm3-4H7.041V7.1h9.975v1.944z" />
            </svg>
          </button>
          <button
            onClick={() => setMenuOpen(menuOpen === "kebab" ? null : "kebab")}
            className="rounded-full p-2 text-wa-text-soft hover:bg-wa-border"
            title="Menu"
            aria-label="Menu"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
            </svg>
          </button>
          {menuOpen === "new" && (
            <div className="absolute right-0 top-11 z-40 w-48 rounded-md bg-wa-panel py-1 shadow-xl ring-1 ring-wa-border">
              {[
                { label: "🤖 New bot", action: () => setModal("bot") },
                { label: "💬 New chat", action: () => setModal("dm") },
                { label: "👥 New group", action: () => setModal("group") },
                { label: "📞 Bot call", action: () => setModal("call") },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    item.action();
                    setMenuOpen(null);
                  }}
                  className="block w-full px-4 py-2 text-left text-sm text-wa-text hover:bg-wa-panel-deep"
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
          {menuOpen === "kebab" && (
            <div className="absolute right-0 top-11 z-40 w-48 rounded-md bg-wa-panel py-1 shadow-xl ring-1 ring-wa-border">
              <Link
                href="/settings"
                onClick={() => setMenuOpen(null)}
                className="block w-full px-4 py-2 text-left text-sm text-wa-text hover:bg-wa-panel-deep"
              >
                ⚙️ Settings
              </Link>
              <button
                onClick={toggleTheme}
                className="block w-full px-4 py-2 text-left text-sm text-wa-text hover:bg-wa-panel-deep"
              >
                🌓 Toggle theme
              </button>
              <button
                onClick={signOut}
                className="block w-full px-4 py-2 text-left text-sm text-wa-text hover:bg-wa-panel-deep"
              >
                🚪 Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* search */}
      <div className="border-b border-wa-border p-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search or start a new chat"
          className="w-full rounded-lg bg-wa-panel-deep px-4 py-1.5 text-sm text-wa-text outline-none placeholder:text-wa-text-soft"
        />
      </div>

      {/* chat list */}
      <div className="flex-1 overflow-y-auto" onClick={() => setMenuOpen(null)}>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-wa-text-soft">
            {chats.length === 0 ? (
              <div className="flex flex-col items-center gap-3">
                <p>No chats yet.</p>
                {bots.length === 0 ? (
                  <button
                    onClick={() => setModal("bot")}
                    className="rounded-full bg-wa-accent px-5 py-2 font-medium text-white transition hover:bg-wa-accent-deep"
                  >
                    🤖 Create your first bot
                  </button>
                ) : (
                  <button
                    onClick={() => setModal("dm")}
                    className="rounded-full bg-wa-accent px-5 py-2 font-medium text-white transition hover:bg-wa-accent-deep"
                  >
                    💬 Start a chat
                  </button>
                )}
                <p className="text-xs">
                  (or use the <span className="font-semibold">new-chat icon</span> in the top bar)
                </p>
              </div>
            ) : (
              "No chats match."
            )}
          </div>
        )}
        {filtered.map((chat) => {
          const chatBots = botsByChat.get(chat.id) ?? [];
          const { name, bot } = chatDisplay(chat, chatBots);
          const preview = previews[chat.id];
          const previewBot = preview?.bot_id ? botsById.get(preview.bot_id) : null;
          const previewText = preview
            ? preview.sender_type === "user"
              ? `You: ${preview.content}`
              : preview.sender_type === "system"
                ? preview.content
                : `${previewBot?.name ?? "Bot"}: ${preview.content}`
            : "No messages yet";
          const active = pathname === `/chats/${chat.id}`;
          return (
            <Link
              key={chat.id}
              href={`/chats/${chat.id}`}
              className={`flex items-center gap-3 px-3 py-2.5 hover:bg-wa-panel-deep ${active ? "bg-wa-panel-deep" : ""}`}
            >
              {chat.type === "dm" ? <BotAvatar bot={bot} size={48} /> : <GroupAvatar size={48} />}
              <div className="min-w-0 flex-1 border-b border-wa-border pb-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate font-medium text-wa-text">{name}</p>
                  {preview && (
                    <span className="shrink-0 text-xs text-wa-text-soft">{formatListTime(preview.created_at)}</span>
                  )}
                </div>
                <p className="truncate text-sm text-wa-text-soft">{previewText}</p>
              </div>
            </Link>
          );
        })}
        {/* bots directory */}
        {bots.length > 0 && (
          <div className="mt-2 border-t border-wa-border px-3 py-2">
            <p className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-wa-text-soft">Your bots</p>
            {bots.map((b) => (
              <button
                key={b.id}
                onClick={() => setEditBot(b)}
                className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-wa-panel-deep"
              >
                <BotAvatar bot={b} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-wa-text">{b.name}</p>
                  <p className="truncate text-xs text-wa-text-soft">{b.model}</p>
                </div>
                <span className="text-xs text-wa-text-soft">edit</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {modal === "bot" && <BotEditor bot={null} onClose={() => setModal(null)} />}
      {editBot && <BotEditor bot={editBot} onClose={() => setEditBot(null)} />}
      {(modal === "dm" || modal === "group" || modal === "call") && (
        <NewChatModal mode={modal} onClose={() => setModal(null)} />
      )}
    </aside>
  );
}
