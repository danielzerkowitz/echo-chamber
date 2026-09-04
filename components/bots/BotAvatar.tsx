"use client";

import type { Bot } from "@/lib/db/types";

export function BotAvatar({
  bot,
  size = 48,
  className = "",
}: {
  bot: Pick<Bot, "avatar_emoji" | "avatar_color"> | null;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: bot?.avatar_color ?? "#8696a0",
        fontSize: size * 0.5,
      }}
    >
      <span className="leading-none">{bot?.avatar_emoji ?? "👥"}</span>
    </div>
  );
}

export function GroupAvatar({ emoji = "👥", size = 48 }: { emoji?: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-wa-panel-deep"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      <span className="leading-none">{emoji}</span>
    </div>
  );
}
