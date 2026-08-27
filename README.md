# Telegram Minesweeper Bot

Minesweeper played entirely inside a single Telegram message, built on
**Bot API 10.3 Rich Messages**: the board is a rich-message `table` whose
cells contain tappable in-body buttons, edited in place on every move.
There is no `reply_markup` / inline keyboard anywhere — the buttons live in
the message body itself.

Runs on **Deno**, with grammY imported straight from source:
`https://cdn.jsdelivr.net/gh/grammyjs/grammy@1/src/mod.ts`.

## Features

- **Difficulties:** Easy 8×8 (10 mines) · Medium 10×10 (15) · Hard 12×12 (24)
- **Dig/Flag mode toggle** (Telegram has no long-press, so one control button
  switches the whole board's tap mode; its color shows the active mode)
- **First-click safety** — mines are placed after the first dig, never on the
  dug cell or its 8 neighbors
- Iterative flood fill on zero cells, win/boom/give-up flows with banners
- **One game per chat** — state lives in the grammY session (keyed by chat id),
  persisted in [grammY free storage](https://jsr.io/@grammyjs/storage-free),
  so games survive bot restarts; in groups the board is co-op
- Staleness guards (per-game nonce + board message id) so taps on old or
  reposted boards get a helpful toast instead of corrupting state
- Frozen boards: finished/replaced boards keep their exact grid geometry with
  greyed-out disabled buttons

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. `cp .env.example .env` and fill in `BOT_TOKEN`, or export it in the shell.
3. Run:

```sh
BOT_TOKEN=123:abc deno task start
```

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
├─ bot.ts             # entry: Bot, lazySession + free storage, wiring
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
tests/                # Deno.test suites
```
