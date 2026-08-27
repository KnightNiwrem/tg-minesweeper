// callback_data build/parse. All payloads stay well under Telegram's 64-byte cap.

import type { Difficulty } from "./game/types.ts";

export const cbCell = (nonce: string, r: number, c: number): string =>
  `ms:${nonce}:c:${r}:${c}`;
export const cbMode = (nonce: string): string => `ms:${nonce}:m`;
export const cbNew = (nonce: string): string => `ms:${nonce}:n`;
export const cbQuit = (nonce: string): string => `ms:${nonce}:q`;
export const cbDiff = (d: Difficulty): string => `ms:diff:${d}`;

// Difficulty picker is nonce-free — it must work when no game exists yet.
export const DIFF_RE = /^ms:diff:(easy|medium|hard)$/;
// Game actions: ms:<nonce>:<c|m|n|q>[:<r>:<c>]
export const ACTION_RE = /^ms:(\w{4}):([cmnq])(?::(\d+):(\d+))?$/;

export type Action =
  | { kind: "cell"; nonce: string; r: number; c: number }
  | { kind: "mode"; nonce: string }
  | { kind: "new"; nonce: string }
  | { kind: "quit"; nonce: string };

export function parseAction(match: RegExpMatchArray): Action {
  const nonce = match[1];
  switch (match[2]) {
    case "c":
      return { kind: "cell", nonce, r: Number(match[3]), c: Number(match[4]) };
    case "m":
      return { kind: "mode", nonce };
    case "n":
      return { kind: "new", nonce };
    default:
      return { kind: "quit", nonce };
  }
}
