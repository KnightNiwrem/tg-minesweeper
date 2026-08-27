// Pure game model — no Telegram/grammY imports anywhere in src/game/.

export type Difficulty = "easy" | "medium" | "hard";
export type Phase = "fresh" | "playing" | "won" | "lost" | "quit";
export type Mode = "dig" | "flag";

export interface DifficultySpec {
  rows: number;
  cols: number;
  mines: number;
  label: string;
}

export const DIFFICULTIES: Record<Difficulty, DifficultySpec> = {
  easy: { rows: 8, cols: 8, mines: 10, label: "Easy 8×8" },
  medium: { rows: 10, cols: 10, mines: 15, label: "Medium 10×10" },
  hard: { rows: 12, cols: 12, mines: 24, label: "Hard 12×12" },
};

export interface Cell {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  adjacent: number;
  exploded?: boolean;
}

// Runtime model — what engine + renderer consume.
export interface GameState {
  nonce: string;
  messageId: number;
  startedBy: number;
  startedByName: string;
  difficulty: Difficulty;
  rows: number;
  cols: number;
  mines: number;
  board: Cell[][];
  phase: Phase;
  mode: Mode;
  minesPlaced: boolean;
  flags: number;
  revealedCount: number;
  startedAt?: number;
}

// Persisted model — compact, well under the 16 KiB free-storage budget.
// `cells` packs one char per cell, "0"–"7": bit1=mine, bit2=revealed, bit4=flagged.
export interface StoredGame {
  nonce: string;
  messageId: number;
  startedBy: number;
  startedByName: string;
  difficulty: Difficulty;
  rows: number;
  cols: number;
  mines: number;
  cells: string;
  phase: Phase;
  mode: Mode;
  minesPlaced: boolean;
  startedAt?: number;
}
