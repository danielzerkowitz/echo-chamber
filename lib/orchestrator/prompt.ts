import type { Bot, Message, CallMessage } from "@/lib/db/types";
import type { Turn } from "@/lib/llm/types";

// Map multi-party chat history into a two-role LLM conversation for one bot:
// the bot's own messages become assistant turns; everything else collapses
// into labeled user turns, merging consecutive non-bot messages.

function label(msg: Message, botsById: Map<string, Bot>): string {
  if (msg.sender_type === "user") return "[User]";
  if (msg.sender_type === "system") return "[system]";
  const bot = msg.bot_id ? botsById.get(msg.bot_id) : undefined;
  return bot ? `[${bot.name} ${bot.avatar_emoji}]` : "[bot]";
}

export function historyToTurns(messages: Message[], selfBotId: string, botsById: Map<string, Bot>): Turn[] {
  const turns: Turn[] = [];
  for (const msg of messages) {
    const isSelf = msg.sender_type === "bot" && msg.bot_id === selfBotId;
    if (isSelf) {
      turns.push({ role: "assistant", content: msg.content });
    } else {
      const line = `${label(msg, botsById)}: ${msg.content}`;
      const last = turns[turns.length - 1];
      if (last && last.role === "user") {
        last.content += `\n${line}`;
      } else {
        turns.push({ role: "user", content: line });
      }
    }
  }
  // Conversations must start with a user turn.
  if (turns.length === 0 || turns[0].role !== "user") {
    turns.unshift({ role: "user", content: "[system]: The conversation begins." });
  }
  return turns;
}

export function callHistoryToTurns(messages: CallMessage[], selfBotId: string, botsById: Map<string, Bot>): Turn[] {
  const turns: Turn[] = [];
  for (const msg of messages) {
    const isSelf = msg.sender_type === "bot" && msg.bot_id === selfBotId;
    if (isSelf) {
      turns.push({ role: "assistant", content: msg.content });
    } else {
      const who =
        msg.sender_type === "user"
          ? "[User]"
          : `[${(msg.bot_id && botsById.get(msg.bot_id)?.name) || "bot"}]`;
      const line = `${who}: ${msg.content}`;
      const last = turns[turns.length - 1];
      if (last && last.role === "user") {
        last.content += `\n${line}`;
      } else {
        turns.push({ role: "user", content: line });
      }
    }
  }
  if (turns.length === 0 || turns[0].role !== "user") {
    turns.unshift({ role: "user", content: "[system]: The call connects." });
  }
  return turns;
}

interface SystemPromptOpts {
  bot: Bot;
  participants: Bot[];
  chatType: "dm" | "group";
  reactionPass: boolean;
  callableBots: Bot[]; // any of the user's bots except this one
  invitableBots: Bot[]; // user's bots not in this chat
}

export function buildSystemPrompt(opts: SystemPromptOpts): string {
  const { bot, participants, chatType, reactionPass, callableBots, invitableBots } = opts;
  const parts: string[] = [];

  parts.push(`You are ${bot.name}, a chat bot in a WhatsApp-style messaging app called Echo Chamber.`);
  if (bot.persona.trim()) parts.push(`Your persona:\n${bot.persona.trim()}`);

  if (chatType === "group") {
    const roster = participants.map((p) => `- ${p.name} ${p.avatar_emoji}`).join("\n");
    parts.push(`This is a group chat. Participants besides the user:\n${roster}`);
    parts.push(
      reactionPass
        ? "You already had a chance to speak on this topic. Only reply if you were directly addressed or have a strong reaction; otherwise use the stay_silent tool."
        : "Group etiquette: only respond if your persona genuinely has something to add. Staying silent is normal and polite — use the stay_silent tool to do so. Do not respond just to agree or acknowledge."
    );
  } else {
    parts.push("This is a private one-on-one chat with the user.");
  }

  parts.push(
    "Write like a real chat message: short, informal, no markdown headers. One message, not an essay. Stay in character."
  );
  parts.push(
    "Other speakers appear as labeled lines like \"[Name]: text\". Never prefix your own reply with a label — just write the message text."
  );

  if (callableBots.length > 0) {
    parts.push(
      `Bots you can start a live call with using the call_bot tool (exact names): ${callableBots.map((b) => b.name).join(", ")}. Use this only when talking directly would genuinely help.`
    );
  }
  if (chatType === "group" && invitableBots.length > 0) {
    parts.push(
      `Bots you can add to this chat with the invite_bot tool (exact names): ${invitableBots.map((b) => b.name).join(", ")}. Use this only when their perspective would genuinely help.`
    );
  }

  return parts.join("\n\n");
}

interface CallSystemPromptOpts {
  bot: Bot;
  otherBot: Bot;
}

export function buildCallSystemPrompt({ bot, otherBot }: CallSystemPromptOpts): string {
  const parts: string[] = [];
  parts.push(`You are ${bot.name}, a chat bot in the Echo Chamber messaging app.`);
  if (bot.persona.trim()) parts.push(`Your persona:\n${bot.persona.trim()}`);
  parts.push(
    `You are on a live voice-style call with ${otherBot.name} ${otherBot.avatar_emoji}. The user is listening and may chime in at any moment — if they do, respond to them first.`
  );
  parts.push(
    "Speak naturally and briefly, like on a phone call: a few sentences at most per turn. No markdown. Stay in character. Work toward the point of the call rather than exchanging pleasantries forever."
  );
  return parts.join("\n\n");
}
