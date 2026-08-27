// One-shot webhook management, run locally (not deployed):
//
//   deno task webhook set https://<your-app>/webhook   # register + set commands
//   deno task webhook info                             # inspect current state
//   deno task webhook delete                           # unregister
//
// Needs BOT_TOKEN (and optionally WEBHOOK_SECRET, which must then also be set
// on the deployed app so both sides agree).

import { bot } from "../src/bot.ts";

const [cmd, url] = Deno.args;

switch (cmd) {
  case "set": {
    if (!url || !url.startsWith("https://")) {
      console.error("usage: deno task webhook set https://<your-app>/webhook");
      Deno.exit(1);
    }
    await bot.api.setWebhook(url, {
      secret_token: Deno.env.get("WEBHOOK_SECRET") || undefined,
      allowed_updates: ["message", "callback_query"],
    });
    await bot.api.setMyCommands([
      { command: "new", description: "Start a game (or repost the current board)" },
      { command: "help", description: "How to play" },
    ]);
    console.log("webhook set to", url);
    break;
  }
  case "info": {
    console.log(await bot.api.getWebhookInfo());
    break;
  }
  case "delete": {
    await bot.api.deleteWebhook();
    console.log("webhook deleted");
    break;
  }
  default:
    console.error("usage: deno task webhook <set <url> | info | delete>");
    Deno.exit(1);
}
