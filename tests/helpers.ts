import { computeAdjacents } from "../src/game/engine.ts";
import type { GameState } from "../src/game/types.ts";

/** Deterministic RNG (mulberry32) for reproducible tests. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lay out an exact mine pattern on a game and mark mines as placed. */
export function setMines(g: GameState, mines: [number, number][]): void {
  for (const row of g.board) {
    for (const cell of row) cell.mine = false;
  }
  for (const [r, c] of mines) g.board[r][c].mine = true;
  g.mines = mines.length;
  computeAdjacents(g);
  g.minesPlaced = true;
  g.phase = "playing";
}
