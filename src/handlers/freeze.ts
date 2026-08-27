import type { ChatStats, MyContext } from "../context.ts";
import type { GameState, StoredGame } from "../game/types.ts";
import { renderGame } from "../render/board.ts";

/**
 * Best-effort: edit a superseded board copy into a frozen (all-disabled)
 * rendering. Failures are ignored — the messageId staleness guard already
 * makes stale copies inert.
 */
export function freezeOldBoard(
  ctx: MyContext,
  messageId: number,
  g: GameState,
  stats: ChatStats,
): void {
  const chatId = ctx.chatId;
  if (chatId === undefined || messageId === 0) return;
  ctx.api
    .editMessageText(chatId, messageId, renderGame(g, stats, { frozen: true }))
    .catch(() => {});
}

/**
 * Repost the live board as a fresh message (moving the game to the bottom of
 * the chat history), make the new copy authoritative, and freeze the old one.
 * User-triggered only — via the ⬇️ Repost button or /new mid-game.
 */
export async function repostBoard(
  ctx: MyContext,
  stored: StoredGame,
  g: GameState,
  stats: ChatStats,
): Promise<void> {
  const oldMessageId = stored.messageId;
  const sent = await ctx.replyWithRichMessage(renderGame(g, stats));
  stored.messageId = sent.message_id;
  freezeOldBoard(ctx, oldMessageId, g, stats);
}
