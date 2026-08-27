import { Composer } from "grammy";
import type { MyContext } from "../context.ts";
import { hydrate } from "../game/store.ts";
import { renderDifficultyPicker, renderHelp } from "../render/board.ts";
import { repostBoard } from "./freeze.ts";

export const commands = new Composer<MyContext>();

// /new with no active game → difficulty picker.
// /new mid-game → REPOST the current board as a fresh message (useful when it
// is buried in group chat); the old copy is frozen best-effort. Abandoning is
// only possible via the explicit 🏳️ Give up button.
commands.command(["start", "new"], async (ctx) => {
  const s = await ctx.session;
  if (s.game && (s.game.phase === "playing" || s.game.phase === "fresh")) {
    await repostBoard(ctx, s.game, hydrate(s.game), s.stats);
    return;
  }
  await ctx.replyWithRichMessage(renderDifficultyPicker());
});

commands.command("help", async (ctx) => {
  await ctx.replyWithRichMessage(renderHelp());
});
