import type { RoundState } from "@/lib/db/types";

export const MAX_PASSES = 2; // initial pass + up to 2 reaction passes
export const MAX_MSGS_PER_BOT = 2;
export const MAX_BOT_MSGS_PER_ROUND = 10;
export const LOCK_TTL_MS = 90_000;

// Deterministic rotation so the same bot doesn't always open the round.
function rotationOffset(seed: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return size > 0 ? hash % size : 0;
}

export function startRound(prev: RoundState, participantIds: string[], seed: string): RoundState {
  const offset = rotationOffset(seed, participantIds.length);
  const queue = [...participantIds.slice(offset), ...participantIds.slice(0, offset)];
  return {
    status: "active",
    version: prev.version + 1,
    pass: 0,
    queue,
    spoke_this_pass: [],
    msgs_per_bot: {},
    total_bot_msgs: 0,
  };
}

export interface TurnOutcome {
  botId: string;
  spoke: boolean;
}

// Advance round state after one bot's turn. Returns the next state; when the
// round is over, status flips back to idle.
export function advanceRound(state: RoundState, outcome: TurnOutcome, participantIds: string[]): RoundState {
  const queue = (state.queue ?? []).filter((id) => id !== outcome.botId);
  const msgsPerBot = { ...(state.msgs_per_bot ?? {}) };
  let spokeThisPass = [...(state.spoke_this_pass ?? [])];
  let totalBotMsgs = state.total_bot_msgs ?? 0;
  let pass = state.pass ?? 0;

  if (outcome.spoke) {
    msgsPerBot[outcome.botId] = (msgsPerBot[outcome.botId] ?? 0) + 1;
    spokeThisPass.push(outcome.botId);
    totalBotMsgs += 1;
  }

  let nextQueue = queue;
  if (nextQueue.length === 0) {
    const anyoneSpoke = spokeThisPass.length > 0;
    const lastSpeaker = spokeThisPass[spokeThisPass.length - 1];
    if (anyoneSpoke && pass < MAX_PASSES && totalBotMsgs < MAX_BOT_MSGS_PER_ROUND && participantIds.length > 1) {
      pass += 1;
      nextQueue = participantIds.filter(
        (id) => id !== lastSpeaker && (msgsPerBot[id] ?? 0) < MAX_MSGS_PER_BOT
      );
      spokeThisPass = [];
    }
  } else {
    // Drop queued bots that already hit their per-round cap.
    nextQueue = nextQueue.filter((id) => (msgsPerBot[id] ?? 0) < MAX_MSGS_PER_BOT);
  }

  const roundOver = nextQueue.length === 0 || totalBotMsgs >= MAX_BOT_MSGS_PER_ROUND;

  return {
    status: roundOver ? "idle" : "active",
    version: state.version + 1,
    locked_until: null,
    pass,
    queue: roundOver ? [] : nextQueue,
    spoke_this_pass: spokeThisPass,
    msgs_per_bot: msgsPerBot,
    total_bot_msgs: totalBotMsgs,
  };
}

export function nextBotId(state: RoundState): string | null {
  return state.status === "active" && state.queue && state.queue.length > 0 ? state.queue[0] : null;
}

export function isReactionPass(state: RoundState): boolean {
  return (state.pass ?? 0) > 0;
}

export function lockExpired(state: RoundState): boolean {
  if (!state.locked_until) return true;
  return new Date(state.locked_until).getTime() < Date.now();
}
