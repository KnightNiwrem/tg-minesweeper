// PURE minesweeper logic — zero grammY imports, fully unit-testable.

import {
  type Cell,
  DIFFICULTIES,
  type Difficulty,
  type GameState,
} from "./types.ts";

/** Injectable randomness source (0 ≤ n < 1), defaults to Math.random. */
export type Rng = () => number;

export type DigResult = "ok" | "boom" | "win" | "noop";

const NONCE_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function makeNonce(rng: Rng = Math.random): string {
  let nonce = "";
  for (let i = 0; i < 4; i++) {
    nonce += NONCE_ALPHABET[Math.floor(rng() * NONCE_ALPHABET.length)];
  }
  return nonce;
}

export function createGame(
  difficulty: Difficulty,
  startedBy: number,
  startedByName: string,
  rng: Rng = Math.random,
): GameState {
  const { rows, cols, mines } = DIFFICULTIES[difficulty];
  const board: Cell[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({ mine: false, revealed: false, flagged: false, adjacent: 0 });
    }
    board.push(row);
  }
  return {
    nonce: makeNonce(rng),
    messageId: 0,
    startedBy,
    startedByName,
    difficulty,
    rows,
    cols,
    mines,
    board,
    phase: "fresh",
    mode: "dig",
    minesPlaced: false,
    flags: 0,
    revealedCount: 0,
  };
}

function* neighbors(
  g: GameState,
  r: number,
  c: number,
): Generator<[number, number]> {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < g.rows && nc >= 0 && nc < g.cols) yield [nr, nc];
    }
  }
}

/** Recompute every cell's `adjacent` from the current mine layout. */
export function computeAdjacents(g: GameState): void {
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      let n = 0;
      for (const [nr, nc] of neighbors(g, r, c)) {
        if (g.board[nr][nc].mine) n++;
      }
      g.board[r][c].adjacent = n;
    }
  }
}

/**
 * Place mines after the first dig. The dug cell and its 8 neighbors are
 * never mined (first-click safety).
 */
export function placeMines(
  g: GameState,
  safeR: number,
  safeC: number,
  rng: Rng = Math.random,
): void {
  const candidates: number[] = [];
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      if (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1) continue;
      candidates.push(r * g.cols + c);
    }
  }
  // Partial Fisher–Yates: draw `mines` distinct cells.
  for (let i = 0; i < g.mines; i++) {
    const j = i + Math.floor(rng() * (candidates.length - i));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    const idx = candidates[i];
    g.board[Math.floor(idx / g.cols)][idx % g.cols].mine = true;
  }
  computeAdjacents(g);
  g.minesPlaced = true;
}

export function checkWin(g: GameState): boolean {
  return g.revealedCount === g.rows * g.cols - g.mines;
}

function inBounds(g: GameState, r: number, c: number): boolean {
  return r >= 0 && r < g.rows && c >= 0 && c < g.cols;
}

/**
 * Dig a cell. On the first dig of a game, mines are placed first (excluding
 * the dug cell and its neighbors) and the clock starts.
 *
 * Returns "noop" for out-of-bounds, finished games, flagged or already
 * revealed cells; "boom" on a mine; "win" when this dig completes the board.
 */
export function dig(
  g: GameState,
  r: number,
  c: number,
  rng: Rng = Math.random,
  now: number = Date.now(),
): DigResult {
  if (g.phase !== "fresh" && g.phase !== "playing") return "noop";
  if (!inBounds(g, r, c)) return "noop";
  const cell = g.board[r][c];
  if (cell.flagged || cell.revealed) return "noop";

  if (!g.minesPlaced) {
    placeMines(g, r, c, rng);
    g.startedAt = now;
    g.phase = "playing";
  }

  if (cell.mine) {
    cell.exploded = true;
    g.phase = "lost";
    return "boom";
  }

  // Iterative flood fill (explicit stack — never recursive).
  const stack: [number, number][] = [[r, c]];
  while (stack.length > 0) {
    const [cr, cc] = stack.pop()!;
    const cur = g.board[cr][cc];
    if (cur.revealed || cur.flagged || cur.mine) continue;
    cur.revealed = true;
    g.revealedCount++;
    if (cur.adjacent === 0) {
      for (const [nr, nc] of neighbors(g, cr, cc)) stack.push([nr, nc]);
    }
  }

  if (checkWin(g)) {
    g.phase = "won";
    return "win";
  }
  g.phase = "playing";
  return "ok";
}

export function toggleFlag(g: GameState, r: number, c: number): "ok" | "noop" {
  if (g.phase !== "fresh" && g.phase !== "playing") return "noop";
  if (!inBounds(g, r, c)) return "noop";
  const cell = g.board[r][c];
  if (cell.revealed) return "noop";
  cell.flagged = !cell.flagged;
  g.flags += cell.flagged ? 1 : -1;
  return "ok";
}

/** Give up: the game ends and the board is revealed by the renderer. */
export function resign(g: GameState): "ok" | "noop" {
  if (g.phase !== "fresh" && g.phase !== "playing") return "noop";
  g.phase = "quit";
  return "ok";
}

export function isOver(g: GameState): boolean {
  return g.phase === "won" || g.phase === "lost" || g.phase === "quit";
}
