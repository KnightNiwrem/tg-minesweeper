# Telegram Minesweeper Bot

Minesweeper played entirely inside a single Telegram message, built on **Bot API
10.3 Rich Messages**: the board is a rich-message `table` whose cells contain
tappable in-body buttons, edited in place on every move. There is no
`reply_markup` / inline keyboard anywhere — the buttons live in the message body
itself.

Runs on **Deno** as a **webhook bot** (designed for
[Deno Deploy](https://deno.com/deploy) v2), with grammY imported straight from
source: `https://cdn.jsdelivr.net/gh/grammyjs/grammy@1/src/mod.ts`.

## Features

- **Difficulties:** Easy 8×8 (10 mines) · Medium 10×10 (15) · Hard 12×12 (24)
- **Dig/Flag mode toggle** (Telegram has no long-press, so one control button
  switches the whole board's tap mode; its color shows the active mode)
- **First-click safety** — mines are placed after the first dig, never on the
  dug cell or its 8 neighbors
- Iterative flood fill on zero cells, win/boom/give-up flows with banners
- **One game per chat** — state lives in the grammY session (keyed by chat id),
  persisted in [Deno KV](https://docs.deno.com/deploy/kv/) via
  [`@grammyjs/storage-denokv`](https://jsr.io/@grammyjs/storage-denokv), so
  games survive restarts and redeploys; in groups the board is co-op
- Staleness guards (per-game nonce + board message id) so taps on old or
  reposted boards get a helpful toast instead of corrupting state
- Frozen boards: finished/replaced boards keep their exact grid geometry with
  greyed-out disabled buttons

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. Pick a webhook secret (any random string) so only Telegram can hit your
   endpoint.

### Deploy on Deno Deploy v2

1. Create an app on [Deno Deploy](https://console.deno.com) from this GitHub
   repo, with **entrypoint `src/main.ts`** (no build step).
2. Set the environment variables `BOT_TOKEN` and `WEBHOOK_SECRET` in the app
   settings and deploy.
3. Point Telegram at the deployed URL (run locally, once):

```sh
BOT_TOKEN=123:abc WEBHOOK_SECRET=... deno task webhook set https://<your-app>/webhook
```

`deno task webhook info` shows Telegram's view of the webhook (pending update
count, last error); `deno task webhook delete` unregisters it.

### Run locally

```sh
BOT_TOKEN=123:abc WEBHOOK_SECRET=... deno task start   # serves on :8000
```

Locally, Deno KV stores sessions in a sqlite file (managed automatically); on
Deno Deploy the platform's built-in KV is used — no configuration needed.

Telegram can only deliver to a public HTTPS URL, so for local end-to-end testing
expose the port with a tunnel (e.g. `cloudflared`, `ngrok`) and
`deno task webhook set` the tunnel URL. `GET /` and `GET /healthz` answer
`200 ok` for health checks.

The `--allow-import` flag (baked into the tasks) is required because grammY is
imported from cdn.jsdelivr.net (with transitive deps on jsr.io and
cdn.skypack.dev).

## Development

```sh
deno task check   # type-check
deno task test    # engine, store, codec, and renderer tests
```

Note on pinning: the grammY import tracks the `1` tag (latest 1.x) per project
requirements, so `deno.json` disables the lockfile. Pin an exact tag in the
import map if you need reproducible builds.

## Layout

```
src/
├─ main.ts            # webhook entrypoint: Deno.serve + webhookCallback (Deno Deploy)
├─ bot.ts             # builds the Bot: sequentialize, lazySession + Deno KV storage, wiring
├─ sequentialize.ts   # per-chat update queue (webhooks deliver concurrently)
├─ context.ts         # MyContext, SessionData, ChatStats
├─ codec.ts           # callback_data build/parse (≤ 64 bytes)
├─ game/
│  ├─ types.ts        # GameState (runtime), StoredGame (persisted)
│  ├─ engine.ts       # pure game logic — zero grammY imports
│  └─ store.ts        # hydrate/dehydrate StoredGame ⇄ GameState
├─ render/
│  ├─ rich.ts         # typed rich-block builders
│  └─ board.ts        # renderGame(state, stats) — pure function of state
└─ handlers/
   ├─ commands.ts     # /start /new /help
   ├─ callbacks.ts    # difficulty picker + game-action routers
   └─ freeze.ts       # best-effort freezing of superseded board copies
scripts/
└─ webhook.ts         # deno task webhook <set <url> | info | delete>
tests/                # Deno.test suites
```
