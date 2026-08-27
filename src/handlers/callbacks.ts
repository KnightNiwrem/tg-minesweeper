import { Composer, GrammyError } from "grammy";
import { ACTION_RE, DIFF_RE, parseAction } from "../codec.ts";
import type { ChatStats, MyContext } from "../context.ts";
import { createGame, dig, isOver, resign, toggleFlag } from "../game/engine.ts";
import { dehydrate, hydrate } from "../game/store.ts";
import type { Difficulty, GameState } from "../game/types.ts";
import { renderDifficultyPicker, renderGame } from "../render/board.ts";
import { repostBoard } from "./freeze.ts";

export const callbacks = new Composer<MyContext>();

function playerName(ctx: MyContext): string {
  return ctx.from?.first_name ?? "anonymous";
}

function updateStats(stats: ChatStats, g: GameState, now: number): void {
  if (g.phase === "won") {
    stats.wins++;
    if (g.startedAt !== undefined) {
      const ms = now - g.startedAt;
      const best = stats.bestMs[g.difficulty];
      if (best === undefined || ms < best) stats.bestMs[g.difficulty] = ms;
    }
  } else if (g.phase === "lost") {
    stats.losses++;
  } else if (g.phase === "quit" && g.minesPlaced) {
    // Giving up an untouched board (no dig yet) is not a loss — it is the
    // only way to back out of a mis-picked difficulty.
    stats.losses++;
  }
}

/** Edit the board message in place, swallowing the expected no-op error. */
async function redraw(ctx: MyContext, g: GameState, stats: ChatStats) {
  try {
    await ctx.editMessageText(renderGame(g, stats));
  } catch (e) {
    if (
      !(e instanceof GrammyError &&
        e.description.includes("message is not modified"))
    ) {
      throw e;
    }
  }
}

// Difficulty picker (nonce-free — must work when no game exists yet).
// This is the ONLY place games are created: it morphs the picker message into
// the board. Reached from /start, /new (idle), and "Play again" (which turns
// a finished board back into a picker in place).
callbacks.callbackQuery(DIFF_RE, async (ctx) => {
  const s = await ctx.session;
  // A stale picker (e.g. an old /start message) must not hijack a live game.
  if (s.game && (s.game.phase === "playing" || s.game.phase === "fresh")) {
    return ctx.answerCallbackQuery({
      text: "A game is already live — finish it or give up first",
    });
  }
  const g = createGame(
    ctx.match[1] as Difficulty,
    ctx.from.id,
    playerName(ctx),
  );
  g.messageId = ctx.msg?.message_id ?? 0;
  await ctx.editMessageText(renderGame(g, s.stats));
  s.game = dehydrate(g);
  await ctx.answerCallbackQuery();
});

// Game actions: cell taps, mode toggle, new game, give up.
callbacks.callbackQuery(ACTION_RE, async (ctx) => {
  const s = await ctx.session;
  const stored = s.game;
  const action = parseAction(ctx.match as RegExpMatchArray);

  // Staleness guard 1: nonce mismatch ⇒ tap on an older/replaced game.
  if (!stored || stored.nonce !== action.nonce) {
    return ctx.answerCallbackQuery({
      text: "That game is over — /new to play",
    });
  }
  // Staleness guard 2: same game but a superseded board copy (repost case).
  if (ctx.msg?.message_id !== stored.messageId) {
    return ctx.answerCallbackQuery({
      text: "Board moved — use the latest message",
    });
  }

  const g = hydrate(stored);

  // "Play again" on a finished board: reuse the message — edit it back into
  // the difficulty picker; picking a difficulty then edits it into the board.
  if (action.kind === "new") {
    if (!isOver(g)) {
      return ctx.answerCallbackQuery({ text: "Game is still live" });
    }
    await ctx.editMessageText(renderDifficultyPicker());
    return ctx.answerCallbackQuery();
  }

  // Explicit repost: move the live board to the newest message.
  if (action.kind === "repost") {
    if (isOver(g)) {
      return ctx.answerCallbackQuery({
        text: "That game is over — /new to play",
      });
    }
    await repostBoard(ctx, stored, g, s.stats);
    return ctx.answerCallbackQuery();
  }

  const wasOver = isOver(g);
  let toast: string | undefined;

  if (action.kind === "mode") {
    if (isOver(g)) {
      toast = "That game is over — /new to play";
    } else {
      g.mode = g.mode === "dig" ? "flag" : "dig";
      toast = g.mode === "dig" ? "⛏️ Dig mode" : "🚩 Flag mode";
    }
  } else if (action.kind === "quit") {
    if (resign(g) === "noop") toast = "That game is over — /new to play";
  } else {
    // Cell tap: dig or flag, per the board-wide mode.
    if (isOver(g)) {
      toast = "That game is over — /new to play";
    } else if (g.mode === "flag") {
      if (toggleFlag(g, action.r, action.c) === "noop") {
        toast = "Can't flag that";
      }
    } else if (g.board[action.r]?.[action.c]?.flagged) {
      toast = "Unflag it first"; // misclick protection
    } else {
      const result = dig(g, action.r, action.c);
      if (result === "boom") toast = "💥 Boom!";
      if (result === "win") toast = "🏆 You win!";
    }
  }

  if (!wasOver && isOver(g)) updateStats(s.stats, g, Date.now());
  // Finished game stays in session (not nulled) so the frozen board's
  // "Play again" nonce still resolves; the next game replaces it.
  s.game = dehydrate(g);

  await redraw(ctx, g, s.stats);
  // Answer AFTER the edit so the client spinner doubles as feedback.
  await ctx.answerCallbackQuery(toast !== undefined ? { text: toast } : {});
});
