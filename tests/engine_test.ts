import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  checkWin,
  createGame,
  dig,
  placeMines,
  resign,
  toggleFlag,
} from "../src/game/engine.ts";
import { seededRng, setMines } from "./helpers.ts";

Deno.test("first-click safety: safe cell and its 8 neighbors are never mined", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const rng = seededRng(seed);
    const g = createGame("easy", 1, "tester", rng);
    placeMines(g, 3, 3, rng);
    let mines = 0;
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        if (g.board[r][c].mine) {
          mines++;
          assert(
            Math.abs(r - 3) > 1 || Math.abs(c - 3) > 1,
            `seed ${seed}: mine at (${r},${c}) inside the safe zone`,
          );
        }
      }
    }
    assertEquals(mines, g.mines, `seed ${seed}: wrong mine count`);
  }
});

Deno.test("adjacent counts are consistent after placement", () => {
  const rng = seededRng(42);
  const g = createGame("medium", 1, "tester", rng);
  placeMines(g, 5, 5, rng);
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      let expected = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const cell = g.board[r + dr]?.[c + dc];
          if (cell?.mine) expected++;
        }
      }
      assertEquals(g.board[r][c].adjacent, expected);
    }
  }
});

Deno.test("flood fill reveals the full zero region and its numbered border", () => {
  const g = createGame("easy", 1, "tester", seededRng(1));
  // All mines in the last row: rows 0–5 are a single zero region,
  // row 6 is the numbered border.
  setMines(g, [[7, 0], [7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6], [7, 7]]);
  const result = dig(g, 0, 0);
  assertEquals(result, "win"); // everything except the mine row is revealed
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 8; c++) {
      assert(g.board[r][c].revealed, `(${r},${c}) should be revealed`);
    }
  }
  for (let c = 0; c < 8; c++) assertFalse(g.board[7][c].revealed);
  assertEquals(g.revealedCount, 56);
});

Deno.test("flood fill does not cross numbered cells", () => {
  const g = createGame("easy", 1, "tester", seededRng(1));
  // A single mine in the center: digging a corner reveals everything except
  // the mine (its ring is numbered, and numbered cells don't expand).
  setMines(g, [[4, 4]]);
  const result = dig(g, 0, 0);
  assertEquals(result, "win");
  assertFalse(g.board[4][4].revealed);
  assertEquals(g.revealedCount, 63);
});

Deno.test("flood fill skips flagged cells", () => {
  const g = createGame("easy", 1, "tester", seededRng(1));
  setMines(g, [[7, 0]]);
  toggleFlag(g, 3, 3); // flag inside the zero region
  const result = dig(g, 0, 0);
  assertFalse(g.board[3][3].revealed, "flagged cell must stay covered");
  assertEquals(result, "ok"); // not a win: the flagged safe cell is unrevealed
  assertEquals(g.revealedCount, 62);
});

Deno.test("digging a mine is boom and marks the fatal cell", () => {
  const g = createGame("easy", 1, "tester", seededRng(1));
  setMines(g, [[2, 2], [5, 5]]);
  assertEquals(dig(g, 2, 2), "boom");
  assertEquals(g.phase, "lost");
  assertEquals(g.board[2][2].exploded, true);
  // no further actions accepted
  assertEquals(dig(g, 0, 0), "noop");
  assertEquals(toggleFlag(g, 0, 0), "noop");
});

Deno.test("win detection: revealing all non-mine cells wins", () => {
  const g = createGame("easy", 1, "tester", seededRng(1));
  setMines(g, [[0, 0]]);
  let last: string = "noop";
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      if (!g.board[r][c].mine && !g.board[r][c].revealed) last = dig(g, r, c);
    }
  }
  assertEquals(last, "win");
  assertEquals(g.phase, "won");
  assert(checkWin(g));
});

Deno.test("flag/unflag invariants", () => {
  const g = createGame("easy", 1, "tester", seededRng(1));
  setMines(g, [[0, 0]]);
  assertEquals(toggleFlag(g, 1, 1), "ok");
  assertEquals(g.flags, 1);
  assert(g.board[1][1].flagged);
  assertEquals(toggleFlag(g, 1, 1), "ok");
  assertEquals(g.flags, 0);
  assertFalse(g.board[1][1].flagged);
  // flagged cells can't be dug
  toggleFlag(g, 1, 1);
  assertEquals(dig(g, 1, 1), "noop");
  // revealed cells can't be flagged
  dig(g, 7, 7);
  assert(g.board[7][7].revealed);
  assertEquals(toggleFlag(g, 7, 7), "noop");
});

Deno.test("first dig places mines, starts the clock, and never explodes", () => {
  const rng = seededRng(7);
  const g = createGame("hard", 9, "tester", rng);
  assertFalse(g.minesPlaced);
  const result = dig(g, 6, 6, rng, 12345);
  assert(result === "ok" || result === "win");
  assert(g.minesPlaced);
  assertEquals(g.startedAt, 12345);
  assertEquals(g.phase, "playing");
});

Deno.test("resign quits the game and blocks further play", () => {
  const g = createGame("easy", 1, "tester", seededRng(1));
  setMines(g, [[0, 0]]);
  assertEquals(resign(g), "ok");
  assertEquals(g.phase, "quit");
  assertEquals(resign(g), "noop");
  assertEquals(dig(g, 5, 5), "noop");
});

Deno.test("out-of-bounds actions are noops", () => {
  const g = createGame("easy", 1, "tester", seededRng(1));
  setMines(g, [[0, 0]]);
  assertEquals(dig(g, -1, 0), "noop");
  assertEquals(dig(g, 0, 99), "noop");
  assertEquals(toggleFlag(g, 8, 0), "noop");
});
