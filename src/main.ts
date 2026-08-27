// Webhook entrypoint for Deno Deploy (v2) — served via Deno.serve.
//
// Telegram POSTs updates to /webhook; register the URL once with
// `deno task webhook set https://<your-app>/webhook` (see scripts/webhook.ts).
// The secret token, when WEBHOOK_SECRET is set, is enforced by grammY's
// webhookCallback (mismatches get a 401 before any update processing).

import { webhookCallback } from "grammy";
import { bot } from "./bot.ts";

const handleUpdate = webhookCallback(bot, "std/http", {
  secretToken: Deno.env.get("WEBHOOK_SECRET") || undefined,
});

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === "POST" && url.pathname === "/webhook") {
    try {
      return await handleUpdate(req);
    } catch (err) {
      // Never let Telegram see a hung request: log and 500 so it retries.
      console.error("webhook error", err);
      return new Response("internal error", { status: 500 });
    }
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz")) {
    return new Response("minesweeper bot: ok");
  }
  return new Response("not found", { status: 404 });
});
