// renderGame(state, stats) — a PURE function of state producing the rich
// message. One re-render per action; the board is edited in place.

import type {
  InputRichBlock,
  InputRichMessage,
  RichBlockTableCell,
  RichMessageButton,
  RichText,
} from "grammy/types";
import { cbCell, cbMode, cbNew, cbQuit, cbRepost } from "../codec.ts";
import { isOver } from "../game/engine.ts";
import { DIFFICULTIES, type GameState } from "../game/types.ts";
import type { ChatStats } from "../context.ts";
import { banner, buttonsRow, cbBtn, para } from "./rich.ts";

export interface RenderOptions {
  /**
   * Freeze this copy of the board: every interactive element is disabled and
   * the controls are replaced with a pointer to the latest message. Used when
   * a game is reposted or replaced.
   */
  frozen?: boolean;
  /** Clock for the elapsed-time display (tests pass a fixed value). */
  now?: number;
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function statusLine(g: GameState, now: number): RichText {
  const elapsed = g.startedAt === undefined ? 0 : now - g.startedAt;
  return `💣 ${g.mines} · 🚩 ${g.flags} · ⏱ ${formatDuration(elapsed)}` +
    ` · game by ${g.startedByName}`;
}

// Adjacent-mine counts as keycap emoji so every label is emoji-width;
// index 0 (*️⃣, keycap asterisk) is the cleared-cell marker — same keycap
// family as the digits.
const DIGIT_LABELS = [
  "*️⃣",
  "1️⃣",
  "2️⃣",
  "3️⃣",
  "4️⃣",
  "5️⃣",
  "6️⃣",
  "7️⃣",
  "8️⃣",
] as const;

// Only TAPPABLE cells are buttons — style:"link" callback buttons render
// borderless, but the client draws a grey pill around DISABLED buttons even
// with style:"link" (seen on a real device), so every unclickable cell is
// plain text instead. All labels are single emoji, so button and text cells
// share the same width and columns never resize during play.
function cellContent(
  g: GameState,
  r: number,
  c: number,
  frozen: boolean,
): RichText {
  const cell = g.board[r][c];
  const over = isOver(g);
  if (over && cell.mine && !cell.flagged) return cell.exploded ? "💥" : "💣";
  if (cell.revealed) return DIGIT_LABELS[cell.adjacent];
  const label = cell.flagged ? "🚩" : "⬜";
  if (over || frozen) return label;
  const button: RichMessageButton = {
    text: label,
    style: "link",
    callback_data: cbCell(g.nonce, r, c),
  };
  return { type: "button", button };
}

function boardTable(g: GameState, frozen: boolean): InputRichBlock {
  return {
    type: "table",
    is_compact: true,
    cells: g.board.map((row, r) =>
      row.map((_cell, c): RichBlockTableCell => ({
        text: cellContent(g, r, c, frozen),
        // align/valign are REQUIRED on every table cell.
        align: "center",
        valign: "middle",
      }))
    ),
  };
}

function controls(g: GameState): InputRichBlock {
  if (isOver(g)) {
    // "Play again" morphs this message back into the difficulty picker.
    return buttonsRow([
      cbBtn("🔄 Play again", cbNew(g.nonce), "primary"),
    ]);
  }
  return buttonsRow([
    g.mode === "dig"
      ? cbBtn("⛏️ Digging", cbMode(g.nonce), "primary")
      : cbBtn("🚩 Flagging", cbMode(g.nonce), "success"),
    cbBtn("⬇️ Repost", cbRepost(g.nonce)),
    cbBtn("🏳️ Give up", cbQuit(g.nonce), "danger"),
  ]);
}

function helpAndStats(stats: ChatStats): RichText {
  const lines = [
    "How to play: tap ⬜ to dig. Toggle to 🚩 Flagging to mark mines.",
    "First dig is always safe. Reveal every safe cell to win.",
    "⬇️ Repost moves the board down to the newest message.",
    "Anyone in this chat can play — it's a shared board.",
    "",
    `This chat: 🏆 ${stats.wins} won · 💥 ${stats.losses} lost`,
  ];
  const bests = (Object.keys(DIFFICULTIES) as (keyof typeof DIFFICULTIES)[])
    .filter((d) => stats.bestMs[d] !== undefined)
    .map((d) =>
      `${DIFFICULTIES[d].label}: ${formatDuration(stats.bestMs[d]!)}`
    );
  if (bests.length > 0) lines.push(`Best times — ${bests.join(" · ")}`);
  return lines.join("\n");
}

export function renderGame(
  g: GameState,
  stats: ChatStats,
  opts: RenderOptions = {},
): InputRichMessage {
  const frozen = opts.frozen ?? false;
  const now = opts.now ?? Date.now();
  const blocks: InputRichBlock[] = [
    para(statusLine(g, now)),
    boardTable(g, frozen),
  ];
  if (g.phase === "won") blocks.push(banner("🏆 You win! 🎉"));
  if (g.phase === "lost") blocks.push(banner("💥 Boom — you hit a mine."));
  if (g.phase === "quit") blocks.push(banner("🏳️ Game over — you gave up."));
  if (frozen) {
    blocks.push(para("⤵️ This board moved — use the latest message."));
  } else {
    blocks.push(controls(g));
    blocks.push({
      type: "expandable_blockquote",
      text: helpAndStats(stats),
    });
  }
  return { blocks };
}

export function renderDifficultyPicker(): InputRichMessage {
  return {
    blocks: [
      { type: "heading", size: 3, text: "💣 Minesweeper" },
      para("Pick a difficulty:"),
      buttonsRow([
        cbBtn(DIFFICULTIES.easy.label, "ms:diff:easy", "success"),
        cbBtn(DIFFICULTIES.medium.label, "ms:diff:medium", "primary"),
        cbBtn(DIFFICULTIES.hard.label, "ms:diff:hard", "danger"),
      ]),
    ],
  };
}

export function renderHelp(): InputRichMessage {
  return {
    blocks: [
      { type: "heading", size: 3, text: "💣 Minesweeper — help" },
      para(
        "/new — start a game (or repost the current board if one is live)\n" +
          "Tap ⬜ to dig; switch the mode button to 🚩 Flagging to mark mines.\n" +
          "The first dig is always safe. Reveal every safe cell to win.\n" +
          "One game per chat — in groups, everyone plays the same board.",
      ),
    ],
  };
}
