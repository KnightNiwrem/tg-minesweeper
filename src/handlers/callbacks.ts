import { Composer, GrammyError } from "grammy";
import { ACTION_RE, DIFF_RE, parseAction } from "../codec.ts";
import type { ChatStats, MyContext } from "../context.ts";
import { createGame, dig, isOver, resign, toggleFlag } from "../game/engine.ts";
import { dehydrate, hydrate } from "../game/store.ts";
import type { Difficulty, GameState } from "../game/types.ts";
import { renderGame } from "../render/board.ts";
import { freezeOldBoard } from "./freeze.ts";

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
  } else if (g.phase === "lost" || g.phase === "quit") {
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
// Morphs the picker message into the board.
callbacks.callbackQuery(DIFF_RE, async (ctx) => {
  const s = await ctx.session;
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
    return ctx.answerCallbackQuery({ text: "That game is over — /new to play" });
  }
  // Staleness guard 2: same game but a superseded board copy (repost case).
  if (ctx.msg?.message_id !== stored.messageId) {
    return ctx.answerCallbackQuery({
      text: "Board moved — use the latest message",
    });
  }

  const g = hydrate(stored);

  // "New game" replaces the current one: fresh nonce, fresh message.
  if (action.kind === "new") {
    const fresh = createGame(g.difficulty, ctx.from.id, playerName(ctx));
    const sent = await ctx.replyWithRichMessage(renderGame(fresh, s.stats));
    fresh.messageId = sent.message_id;
    s.game = dehydrate(fresh);
    if (!isOver(g)) g.phase = "quit"; // freeze the old live board as ended (not counted as a loss)
    freezeOldBoard(ctx, stored.messageId, g, s.stats);
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
      if (toggleFlag(g, action.r, action.c) === "noop") toast = "Can't flag that";
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
