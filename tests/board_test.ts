import { assert, assertEquals, assertFalse } from "@std/assert";
import type {
  InputRichBlock,
  InputRichMessage,
  RichMessageButton,
  RichText,
} from "grammy/types";
import { createGame, dig, resign, toggleFlag } from "../src/game/engine.ts";
import type { ChatStats } from "../src/context.ts";
import {
  renderDifficultyPicker,
  renderGame,
} from "../src/render/board.ts";
import { seededRng, setMines } from "./helpers.ts";

const stats: ChatStats = { wins: 3, losses: 1, bestMs: { easy: 83_000 } };
const enc = new TextEncoder();

function tableOf(msg: InputRichMessage) {
  const table = msg.blocks?.find((b) => b.type === "table");
  assert(table !== undefined && table.type === "table");
  return table;
}

function collectButtons(msg: InputRichMessage): RichMessageButton[] {
  const found: RichMessageButton[] = [];
  const walkText = (t: RichText | undefined): void => {
    if (t === undefined || typeof t === "string") return;
    if (Array.isArray(t)) return t.forEach(walkText);
    if (t.type === "button") found.push(t.button);
    else if ("text" in t) walkText(t.text as RichText);
  };
  for (const block of msg.blocks ?? []) {
    if (block.type === "buttons") found.push(...block.buttons);
    else if (block.type === "table") {
      for (const row of block.cells) for (const cell of row) walkText(cell.text);
    } else if ("text" in block) walkText(block.text as RichText);
  }
  return found;
}

function assertLimits(msg: InputRichMessage) {
  assert((msg.blocks?.length ?? 0) <= 500, "block cap");
  for (const block of msg.blocks ?? []) {
    if (block.type === "table") {
      for (const row of block.cells) {
        assert(row.length <= 20, "table column cap");
        for (const cell of row) {
          // align/valign are REQUIRED on every cell
          assert(cell.align !== undefined, "cell missing align");
          assert(cell.valign !== undefined, "cell missing valign");
        }
      }
    }
    if (block.type === "buttons") {
      assert(block.buttons.length >= 1 && block.buttons.length <= 8, "buttons cap");
    }
  }
  for (const b of collectButtons(msg)) {
    if ("callback_data" in b) {
      assert(enc.encode(b.callback_data).length <= 64, "callback_data cap");
    }
  }
}

Deno.test("mid-game board: structure, limits, and cell states", () => {
  const g = createGame("easy", 1, "Ann", seededRng(3));
  setMines(g, [[0, 7], [7, 7]]);
  g.startedAt = 1000;
  toggleFlag(g, 0, 7);
  dig(g, 1, 6); // numbered cell: reveals only itself, so the game stays live
  assertEquals(g.phase, "playing");
  const msg = renderGame(g, stats, { now: 103_000 });
  assertLimits(msg);

  assertEquals(msg.blocks?.[0].type, "paragraph");
  const table = tableOf(msg);
  assertEquals(table.cells.length, 8);
  assertEquals(table.is_compact, true);

  // Flagged covered cell renders as a live 🚩 callback button
  const flaggedCell = table.cells[0][7].text;
  assert(typeof flaggedCell === "object" && !Array.isArray(flaggedCell));
  assert(flaggedCell.type === "button");
  assertEquals(flaggedCell.button.text, "🚩");
  assert("callback_data" in flaggedCell.button);

  // Live controls: mode toggle + Repost + Give up (no "New" while live)
  const controls = msg.blocks?.find((b) => b.type === "buttons");
  assert(controls !== undefined && controls.type === "buttons");
  const suffixes = controls.buttons.map((b) =>
    "callback_data" in b ? b.callback_data.slice(-2) : "??"
  );
  assertEquals(suffixes, [":m", ":r", ":q"]);

  // Status line shows counts, elapsed time, and the starter's name
  const status = msg.blocks?.[0];
  assert(status !== undefined && status.type === "paragraph");
  assertEquals(status.text, "💣 2 · 🚩 1 · ⏱ 1:42 · game by Ann");

  // Help/stats footer present while live
  assert(msg.blocks?.some((b) => b.type === "expandable_blockquote"));
});

Deno.test("lost board: mines shown, remaining cells disabled, single control", () => {
  const g = createGame("easy", 1, "Bob", seededRng(4));
  setMines(g, [[2, 2], [5, 5]]);
  toggleFlag(g, 5, 5);
  dig(g, 2, 2); // boom
  assertEquals(g.phase, "lost");
  const msg = renderGame(g, stats);
  assertLimits(msg);

  const table = tableOf(msg);
  // Fatal mine renders as plain 💥 text
  assertEquals(table.cells[2][2].text, "💥");
  // Flagged mine keeps its flag (as a disabled button)
  const flagged = table.cells[5][5].text;
  assert(typeof flagged === "object" && !Array.isArray(flagged) && flagged.type === "button");
  assert("disabled" in flagged.button);
  // Every remaining covered cell is a disabled button — geometry stays stable
  for (const b of collectButtons(msg)) {
    if (b.text === "⬜") assert("disabled" in b);
  }
  // Banner + single "Play again" control (leads back to the difficulty picker)
  assert(msg.blocks?.some((b) => b.type === "blockquote"));
  const controls = msg.blocks?.find((b) => b.type === "buttons");
  assert(controls !== undefined && controls.type === "buttons");
  assertEquals(controls.buttons.length, 1);
  assert("callback_data" in controls.buttons[0]);
  assert(controls.buttons[0].callback_data.endsWith(":n"));
});

Deno.test("won board renders the win banner", () => {
  const g = createGame("easy", 1, "Cy", seededRng(5));
  setMines(g, [[4, 4]]);
  assertEquals(dig(g, 0, 0), "win");
  const msg = renderGame(g, stats);
  assertLimits(msg);
  assert(msg.blocks?.some((b) => b.type === "blockquote"));
});

Deno.test("frozen board has no live buttons at all", () => {
  const g = createGame("medium", 1, "Di", seededRng(6));
  setMines(g, [[0, 0]]);
  dig(g, 9, 9);
  const msg = renderGame(g, stats, { frozen: true });
  assertLimits(msg);
  for (const b of collectButtons(msg)) {
    assert("disabled" in b, "frozen board must contain only disabled buttons");
  }
  assertFalse(msg.blocks?.some((b) => b.type === "buttons") ?? false);
});

Deno.test("hard board respects the 20-column cap with all 144 cells tappable", () => {
  const rng = seededRng(7);
  const g = createGame("hard", 1, "Ed", rng);
  const msg = renderGame(g, stats);
  assertLimits(msg);
  const table = tableOf(msg);
  assertEquals(table.cells.length, 12);
  assertEquals(table.cells[0].length, 12);
  const live = collectButtons(msg).filter((b) => "callback_data" in b);
  assert(live.length >= 144, "all cells plus controls should be tappable");
});

Deno.test("difficulty picker structure", () => {
  const msg = renderDifficultyPicker();
  assertLimits(msg);
  const controls = msg.blocks?.find((b) => b.type === "buttons");
  assert(controls !== undefined && controls.type === "buttons");
  assertEquals(controls.buttons.length, 3);
});

// Keep TS aware these imports are used for typing the walker above.
const _typecheck: InputRichBlock[] = [];
void _typecheck;
void resign;
