import type { Context, LazySessionFlavor } from "grammy";
import type { Difficulty, StoredGame } from "./game/types.ts";

export interface ChatStats {
  wins: number;
  losses: number;
  bestMs: Partial<Record<Difficulty, number>>;
}

export interface SessionData {
  v: 1;
  game: StoredGame | null;
  stats: ChatStats;
}

// Session plugin rule: initial() must return a FRESH object per call.
export function initialSession(): SessionData {
  return { v: 1, game: null, stats: { wins: 0, losses: 0, bestMs: {} } };
}

export type MyContext = Context & LazySessionFlavor<SessionData>;
