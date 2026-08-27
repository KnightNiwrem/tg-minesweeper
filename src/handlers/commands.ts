import { Composer } from "grammy";
import type { MyContext } from "../context.ts";
import { hydrate } from "../game/store.ts";
import {
  renderDifficultyPicker,
  renderGame,
  renderHelp,
} from "../render/board.ts";
import { freezeOldBoard } from "./freeze.ts";

export const commands = new Composer<MyContext>();

// /new with no active game → difficulty picker.
// /new mid-game → REPOST the current board as a fresh message (useful when it
// is buried in group chat); the old copy is frozen best-effort. Abandoning is
// only possible via the explicit 🏳️ Give up button.
commands.command(["start", "new"], async (ctx) => {
  const s = await ctx.session;
  if (s.game && (s.game.phase === "playing" || s.game.phase === "fresh")) {
    const g = hydrate(s.game);
    const oldMessageId = s.game.messageId;
    const sent = await ctx.replyWithRichMessage(renderGame(g, s.stats));
    s.game.messageId = sent.message_id; // the new copy is authoritative
    freezeOldBoard(ctx, oldMessageId, g, s.stats);
    return;
  }
  await ctx.replyWithRichMessage(renderDifficultyPicker());
});

commands.command("help", async (ctx) => {
  await ctx.replyWithRichMessage(renderHelp());
});
