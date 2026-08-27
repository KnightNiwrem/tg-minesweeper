import { Bot, lazySession } from "grammy";
import { freeStorage } from "@grammyjs/storage-free";
import { initialSession, type MyContext, type SessionData } from "./context.ts";
import { commands } from "./handlers/commands.ts";
import { callbacks } from "./handlers/callbacks.ts";

const token = Deno.env.get("BOT_TOKEN");
if (token === undefined || token === "") {
  console.error("BOT_TOKEN environment variable is required");
  Deno.exit(1);
}

const bot = new Bot<MyContext>(token);

// lazySession (not session): free storage is a remote HTTP service; lazy means
// ordinary group chatter never touches storage — only handlers that
// `await ctx.session`. Default session key is the chat id, so one chat ⇒ one
// session ⇒ at most one game, structurally. Default bot.start() long polling
// is sequential, so there are no session races out of the box; if ever
// migrating to @grammyjs/runner or webhooks, add
// `sequentialize((ctx) => ctx.chatId?.toString())` before this middleware.
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

await bot.api.setMyCommands([
  { command: "new", description: "Start a game (or repost the current board)" },
  { command: "help", description: "How to play" },
]);

console.log("minesweeper bot starting (long polling)…");
bot.start();
