import type { MiddlewareFn } from "grammy";
import type { MyContext } from "./context.ts";

/**
 * Per-chat update queue. Long polling processed updates sequentially, but
 * webhooks deliver them concurrently — two rapid taps on the same board could
 * otherwise interleave their session read/modify/write and lose a move.
 * (@grammyjs/runner's sequentialize is not published on JSR, so this is a
 * minimal local equivalent keyed by chat id, matching the session key.)
 *
 * Note: this serializes within one isolate. On Deno Deploy multiple isolates
 * can exist; cross-isolate races on the same chat are still possible but
 * require two taps to land on different isolates in the same instant —
 * acceptable for a game where the failure mode is one lost tap.
 */
export function sequentialize(): MiddlewareFn<MyContext> {
  const tails = new Map<string, Promise<void>>();
  return async (ctx, next) => {
    const key = ctx.chatId?.toString();
    if (key === undefined) return await next();
    const prev = tails.get(key) ?? Promise.resolve();
    const run = prev.then(() => next());
    const tail = run.then(() => undefined, () => undefined);
    tails.set(key, tail);
    try {
      await run;
    } finally {
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}
