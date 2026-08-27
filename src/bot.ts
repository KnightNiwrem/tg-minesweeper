// Builds the bot; does NOT start it. The webhook entrypoint is src/main.ts
// (webhookCallback initializes the bot lazily on the first update).

import { Bot, lazySession } from "grammy";
import { freeStorage } from "@grammyjs/storage-free";
import { initialSession, type MyContext, type SessionData } from "./context.ts";
import { sequentialize } from "./sequentialize.ts";
import { commands } from "./handlers/commands.ts";
import { callbacks } from "./handlers/callbacks.ts";

const token = Deno.env.get("BOT_TOKEN");
if (token === undefined || token === "") {
  console.error("BOT_TOKEN environment variable is required");
  Deno.exit(1);
}

export const bot = new Bot<MyContext>(token);

// Webhook updates arrive concurrently — serialize per chat BEFORE the session
// middleware so each read/modify/write cycle is atomic per chat.
bot.use(sequentialize());

// lazySession (not session): free storage is a remote HTTP service; lazy means
// ordinary group chatter never touches storage — only handlers that
// `await ctx.session`. Default session key is the chat id, so one chat ⇒ one
// session ⇒ at most one game, structurally.
//
// The free-storage package still types readAllKeys() as Promise<string[]>,
// which newer grammY StorageAdapter typings reject — expose only the three
// methods the session plugin actually uses.
const free = freeStorage<SessionData>(bot.token);
bot.use(lazySession({
  initial: initialSession,
  storage: {
    read: (key) => free.read(key),
    write: (key, value) => free.write(key, value),
    delete: (key) => free.delete(key),
  },
}));

bot.use(commands);
bot.use(callbacks);

// Free storage can fail transiently (remote HTTP) — log and let the user
// retry the tap.
bot.catch((err) => console.error("bot error", err.error));
