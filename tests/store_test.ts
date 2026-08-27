import { assert, assertEquals } from "@std/assert";
import { createGame, dig, toggleFlag } from "../src/game/engine.ts";
import { dehydrate, hydrate } from "../src/game/store.ts";
import type { GameState } from "../src/game/types.ts";
import { seededRng, setMines } from "./helpers.ts";

Deno.test("cells codec: all 8 mine/revealed/flagged combos round-trip", () => {
  const g = createGame("easy", 1, "tester", seededRng(1));
  // Write all 8 bit combinations into the first 8 cells of row 0.
  for (let i = 0; i < 8; i++) {
    const cell = g.board[0][i];
    cell.mine = (i & 1) !== 0;
    cell.revealed = (i & 2) !== 0;
    cell.flagged = (i & 4) !== 0;
  }
  const stored = dehydrate(g);
  assertEquals(stored.cells.slice(0, 8), "01234567");
  const back = hydrate(stored);
  for (let i = 0; i < 8; i++) {
    assertEquals(back.board[0][i].mine, (i & 1) !== 0, `mine bit, combo ${i}`);
    assertEquals(
      back.board[0][i].revealed,
      (i & 2) !== 0,
      `revealed bit, combo ${i}`,
    );
    assertEquals(
      back.board[0][i].flagged,
      (i & 4) !== 0,
      `flagged bit, combo ${i}`,
    );
  }
});

function assertHydrateIdentity(g: GameState) {
  const back = hydrate(dehydrate(g));
  // Scalar fields
  assertEquals(back.nonce, g.nonce);
  assertEquals(back.messageId, g.messageId);
  assertEquals(back.startedBy, g.startedBy);
  assertEquals(back.startedByName, g.startedByName);
  assertEquals(back.difficulty, g.difficulty);
  assertEquals(back.rows, g.rows);
  assertEquals(back.cols, g.cols);
  assertEquals(back.mines, g.mines);
  assertEquals(back.phase, g.phase);
  assertEquals(back.mode, g.mode);
  assertEquals(back.minesPlaced, g.minesPlaced);
  assertEquals(back.startedAt, g.startedAt);
  // Board + recomputed fields must match the live game exactly
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const a = g.board[r][c];
      const b = back.board[r][c];
      assertEquals(b.mine, a.mine, `(${r},${c}) mine`);
      assertEquals(b.revealed, a.revealed, `(${r},${c}) revealed`);
      assertEquals(b.flagged, a.flagged, `(${r},${c}) flagged`);
      assertEquals(b.adjacent, a.adjacent, `(${r},${c}) adjacent`);
    }
  }
  assertEquals(back.flags, g.flags);
  assertEquals(back.revealedCount, g.revealedCount);
}

Deno.test("hydrate(dehydrate(g)) is identity across random play (property test)", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const rng = seededRng(seed * 1000);
    const difficulty = (["easy", "medium", "hard"] as const)[seed % 3];
    const g = createGame(difficulty, seed, `p${seed}`, rng);
    g.messageId = 100 + seed;
    // Random sequence of digs and flags
    for (let i = 0; i < 30; i++) {
      const r = Math.floor(rng() * g.rows);
      const c = Math.floor(rng() * g.cols);
      if (rng() < 0.3) toggleFlag(g, r, c);
      else dig(g, r, c, rng, 1_000_000 + i);
      assertHydrateIdentity(g);
      if (g.phase === "won" || g.phase === "lost") break;
    }
  }
});

Deno.test("stored payload stays far under the 16 KiB free-storage budget", () => {
  const rng = seededRng(9);
  const g = createGame("hard", 1, "someone with a long name", rng);
  dig(g, 5, 5, rng);
  const bytes = new TextEncoder().encode(JSON.stringify(dehydrate(g))).length;
  assert(bytes < 1024, `stored game is ${bytes} bytes, expected < 1 KiB`);
});

Deno.test("fixed layout survives the round trip", () => {
  const g = createGame("easy", 1, "tester", seededRng(1));
  setMines(g, [[0, 7], [3, 4], [7, 7]]);
  dig(g, 7, 0);
  toggleFlag(g, 0, 7);
  assertHydrateIdentity(g);
});
