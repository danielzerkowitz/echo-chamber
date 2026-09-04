import type { Provider } from "@/lib/llm/types";

export interface Bot {
  id: string;
  user_id: string;
  name: string;
  avatar_emoji: string;
  avatar_color: string;
  persona: string;
  provider: Provider;
  model: string;
  temperature: number | null;
  created_at: string;
  updated_at: string;
}

export interface RoundState {
  status: "idle" | "active";
  version: number;
  locked_until?: string | null;
  pass?: number;
  queue?: string[]; // bot ids still to speak this pass
  spoke_this_pass?: string[];
  msgs_per_bot?: Record<string, number>;
  total_bot_msgs?: number;
}

export interface Chat {
  id: string;
  user_id: string;
  type: "dm" | "group";
  title: string | null;
  round: RoundState;
  last_message_at: string;
  created_at: string;
}

export interface ChatParticipant {
  chat_id: string;
  bot_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
}

export interface Message {
  id: string;
  chat_id: string;
  user_id: string;
  sender_type: "user" | "bot" | "system";
  bot_id: string | null;
  kind: "text" | "event" | "call_summary";
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Call {
  id: string;
  user_id: string;
  chat_id: string | null;
  bot_a: string;
  bot_b: string;
  status: "active" | "ended";
  round_limit: number;
  rounds_used: number;
  locked_until: string | null;
  started_by: "user" | "bot";
  summary: string | null;
  created_at: string;
  ended_at: string | null;
}

export interface CallMessage {
  id: string;
  call_id: string;
  user_id: string;
  sender_type: "user" | "bot";
  bot_id: string | null;
  content: string;
  created_at: string;
}

export interface ProviderKeyMeta {
  id: string;
  user_id: string;
  provider: Provider;
  key_hint: string;
  created_at: string;
}
