// Builds the bot; does NOT start it. The webhook entrypoint is src/main.ts
// (webhookCallback initializes the bot lazily on the first update).

import { Bot, lazySession } from "grammy";
import { DenoKVAdapter } from "@grammyjs/storage-denokv";
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

// lazySession (not session): storage is external I/O; lazy means ordinary
// group chatter never touches it — only handlers that `await ctx.session`.
// Default session key is the chat id, so one chat ⇒ one session ⇒ at most one
// game, structurally.
//
// Sessions live in Deno KV (built into Deno Deploy; a sqlite file locally,
// hence the kv unstable flag + read/write permissions in the tasks). This
// replaced @grammyjs/storage-free: its hosted backend ran on Classic Deno
// Deploy, which was shut down.
const kv = await Deno.openKv();
bot.use(lazySession({
  initial: initialSession,
  storage: new DenoKVAdapter<SessionData>(kv),
}));

bot.use(commands);
bot.use(callbacks);

// Storage/API hiccups: log and let the user retry the tap.
bot.catch((err) => console.error("bot error", err.error));
