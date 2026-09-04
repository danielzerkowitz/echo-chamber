import type { ToolDef } from "@/lib/llm/types";

export const STAY_SILENT: ToolDef = {
  name: "stay_silent",
  description:
    "Use this to skip your turn without saying anything. Staying silent is normal and polite in a group chat when you have nothing meaningful to add.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
};

export const CALL_BOT: ToolDef = {
  name: "call_bot",
  description:
    "Start a live one-on-one call with another bot when talking directly would genuinely help (e.g. you need their expertise, or you want to hash something out). The user watches the call and can join in. Use sparingly.",
  parameters: {
    type: "object",
    properties: {
      bot_name: { type: "string", description: "Exact name of the bot to call." },
    },
    required: ["bot_name"],
    additionalProperties: false,
  },
};

export const INVITE_BOT: ToolDef = {
  name: "invite_bot",
  description:
    "Add another bot to this group chat when their perspective would help the conversation. They will see the chat history and start participating.",
  parameters: {
    type: "object",
    properties: {
      bot_name: { type: "string", description: "Exact name of the bot to invite." },
    },
    required: ["bot_name"],
    additionalProperties: false,
  },
};
