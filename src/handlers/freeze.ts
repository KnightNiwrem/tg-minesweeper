import type { ChatStats, MyContext } from "../context.ts";
import type { GameState } from "../game/types.ts";
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
