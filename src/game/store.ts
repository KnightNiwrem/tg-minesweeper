// StoredGame ⇄ GameState. Computed fields (adjacent, flags, revealedCount)
// are never persisted — hydrate() recomputes them, so stored state cannot go
// internally inconsistent.

import { computeAdjacents } from "./engine.ts";
import type { Cell, GameState, StoredGame } from "./types.ts";

const MINE = 1;
const REVEALED = 2;
const FLAGGED = 4;

export function dehydrate(g: GameState): StoredGame {
  let cells = "";
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const cell = g.board[r][c];
      cells += String(
        (cell.mine ? MINE : 0) |
          (cell.revealed ? REVEALED : 0) |
          (cell.flagged ? FLAGGED : 0),
      );
    }
  }
  return {
    nonce: g.nonce,
    messageId: g.messageId,
    startedBy: g.startedBy,
    startedByName: g.startedByName,
    difficulty: g.difficulty,
    rows: g.rows,
    cols: g.cols,
    mines: g.mines,
    cells,
    phase: g.phase,
    mode: g.mode,
    minesPlaced: g.minesPlaced,
    startedAt: g.startedAt,
  };
}

export function hydrate(s: StoredGame): GameState {
  const board: Cell[][] = [];
  let flags = 0;
  let revealedCount = 0;
  for (let r = 0; r < s.rows; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < s.cols; c++) {
      const bits = s.cells.charCodeAt(r * s.cols + c) - 48;
      const cell: Cell = {
        mine: (bits & MINE) !== 0,
        revealed: (bits & REVEALED) !== 0,
        flagged: (bits & FLAGGED) !== 0,
        adjacent: 0,
      };
      if (cell.flagged) flags++;
      if (cell.revealed) revealedCount++;
      row.push(cell);
    }
    board.push(row);
  }
  const g: GameState = {
    nonce: s.nonce,
    messageId: s.messageId,
    startedBy: s.startedBy,
    startedByName: s.startedByName,
    difficulty: s.difficulty,
    rows: s.rows,
    cols: s.cols,
    mines: s.mines,
    board,
    phase: s.phase,
    mode: s.mode,
    minesPlaced: s.minesPlaced,
    flags,
    revealedCount,
    startedAt: s.startedAt,
  };
  computeAdjacents(g);
  return g;
}
