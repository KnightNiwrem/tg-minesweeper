# Telegram Minesweeper Bot — Implementation Plan (post-implementation revision)

**Target:** **Deno** + TypeScript · grammY via URL import
`https://cdn.jsdelivr.net/gh/grammyjs/grammy@1/src/mod.ts` · `jsr:@grammyjs/storage-free`
**Feature basis:** Telegram Bot API 10.3 **Rich Messages** — interactive buttons rendered *inside* the message body (including inside table cells), used to build a tappable minesweeper grid in a single message that is edited in place.

> **Revision note:** This plan was originally written for Node.js + `grammy@1.46.0` and has been
> revised after a full, working implementation on Deno (2026-08-27, this repo). Everything below
> reflects what was actually verified against the fetched grammY source and what actually bit
> during implementation. Sections marked **[verified in practice]** were re-checked against the
> real fetched code, not just docs.

---

## ⚠️ READ FIRST — API knowledge cutoff warning

This bot uses **Rich Messages** (Bot API 10.1, June 2026) and **rich-message buttons** (Bot API 10.3, August 2026). These are **newer than most training data**. Everything in §1 below was verified directly against the grammY source actually fetched from the jsdelivr `@1` tag (which resolved to **grammY 1.45.1** at implementation time — all rich-message types present).

**Do NOT:**
- "Correct" the design into `InlineKeyboardMarkup` / `reply_markup`. The buttons in this design live in the **message body blocks**, not in a keyboard below the message. That is the entire point.
- Guess at type shapes. Use §1 verbatim. If TypeScript disagrees with §1, trust the installed types and adjust minimally.
- Use `parse_mode` / MarkdownV2 anywhere. Rich messages use `InputRichMessage` with `blocks`.
- Pre-verify the API surface from memory. **Fetch and grep the actual source first** (see §0) — it takes two minutes and eliminates the whole class of "trained-in correction" bugs.

---

## 0. Runtime & dependency setup **[verified in practice]**

### 0.1 deno.json

```jsonc
{
  "tasks": {
    "start": "deno run --allow-import --allow-net --allow-env src/bot.ts",
    "check": "deno check --allow-import src/bot.ts",
    "test": "deno test --allow-import tests/"
  },
  "imports": {
    "grammy": "https://cdn.jsdelivr.net/gh/grammyjs/grammy@1/src/mod.ts",
    "grammy/types": "https://cdn.jsdelivr.net/gh/grammyjs/grammy@1/src/types.ts",
    "@grammyjs/storage-free": "jsr:@grammyjs/storage-free@^2.6.0",
    "@std/assert": "jsr:@std/assert@^1.0.0"
  },
  "lock": false,
  "compilerOptions": { "strict": true }
}
```

Hard-won specifics:

1. **`--allow-import` is mandatory** on every deno invocation (run/check/test). grammY's
   `platform.deno.ts` pulls `debug` from **cdn.skypack.dev**, and `types.deno.ts` pulls
   `@std/path` from **jsr.io** — Deno 2 refuses these hosts without the flag.
2. **`grammy/types` must be mapped separately.** grammY's `mod.ts` does **not** re-export the
   Bot API types (only `InputFile`). All rich-message types come from `src/types.ts`.
3. **`"lock": false`** because `@1` is a moving tag: a committed lockfile hard-fails with an
   integrity error the moment upstream publishes a new 1.x. Pin an exact tag instead if you
   want reproducible builds — then re-enable the lock.
4. **Storage comes from JSR** (`jsr:@grammyjs/storage-free`), not npm and not deno.land/x.
   In the implementation environment, deno.land and esm.sh were unreachable (proxy), and the
   raw GitHub source of the storages monorepo uses Node-style `./adapter.js` specifiers Deno
   can't resolve. JSR worked everywhere jsdelivr did. Check
   `https://jsr.io/@grammyjs/storage-free/meta.json` to confirm the latest version.
5. **Tests: `Deno.test` + `jsr:@std/assert`** (no vitest, no npm dev-deps at all). `deno test`
   type-checks test files by default — free extra checking.
6. Env: `Deno.env.get("BOT_TOKEN")`; exit with a clear error if missing.

### 0.2 Verify-before-coding ritual (do this first, it pays for itself)

```sh
echo 'export * from "grammy";' > /tmp/probe.ts && deno cache --allow-import /tmp/probe.ts
# then grep the Deno cache for ground truth:
#   grep -rl "sendRichMessage"            ~/.cache/deno/remote
#   grep -A12 "interface RichBlockTableCell" <hit>
#   grep -n "export function lazySession\|LazySessionFlavor\|StorageAdapter" <session.ts hit>
```

The `denoCacheMetadata` JSON at the bottom of each cached file shows the resolved URL and the
`x-jsd-version` header (how you learn what `@1` actually resolved to).

---

## 1. Verified API surface (ground truth) **[verified in practice]**

### 1.1 Types (import from `grammy/types` — the mapped `src/types.ts`)

```ts
// Send payload: exactly ONE of blocks / html / markdown
interface InputRichMessage {
  blocks?: InputRichBlock[];
  html?: string;
  markdown?: string;
  media?: InputRichMessageMedia[];   // only for tg:// links in html/markdown — unused here
  is_rtl?: boolean;
  skip_entity_detection?: boolean;
}
// NOTE: in the raw types package these are generic (InputRichBlock<F>, InputRichMessage<F>).
// grammY's types.ts re-exports them with F bound to InputFile — import from "grammy/types"
// and you never see the generic.

// The grid
interface InputRichBlockTable {
  type: "table";
  cells: RichBlockTableCell[][];
  is_bordered?: true;
  is_striped?: true;
  is_compact?: true;                 // smaller cell indents — use this for the game board
  caption?: RichText;
}

interface RichBlockTableCell {
  text?: RichText;                   // omitted = invisible cell
  is_header?: true;
  colspan?: number;
  rowspan?: number;
  align: "left" | "center" | "right";    // REQUIRED (not optional!)
  valign: "top" | "middle" | "bottom";   // REQUIRED (not optional!)
}

// RichText is a union: string | RichText[] | entity objects, including:
interface RichTextBold   { type: "bold"; text: RichText }
interface RichTextButton { type: "button"; button: RichMessageButton }
// ^^^ THE KEY TRICK: RichTextButton is a member of the RichText union,
//     so a button can be placed INSIDE a table cell's `text`.

// A button: { text, style? } + EXACTLY ONE action field.
// Declared as a namespace-based union: RichMessageButton.CallbackButton,
// RichMessageButton.UrlButton, RichMessageButton.DisabledButtonButton, …
// In practice you just write object literals:
//   { text: "⬜", callback_data: "…" }          // 1–64 bytes
//   { text: "⬜", disabled: {} }                 // greyed-out, does nothing
//   { text: "Go", style: "primary", callback_data: "…" }
type ButtonStyle = "danger" | "success" | "primary" | "link";
// Rules: button `text` may contain ONLY plain text, custom-emoji, and date-time
//        entities (no bold/marked). Style "link" is allowed ONLY on callback buttons
//        (renders like a plain link, no border).

// Standalone button row (the control bar under the board)
interface InputRichBlockButtons {
  type: "buttons";
  buttons: RichMessageButton[];      // 1–8 buttons
  align?: "left" | "center" | "right";
}

// Other blocks used: paragraph, heading, blockquote, expandable_blockquote
interface InputRichBlockParagraph { type: "paragraph"; text: RichText }
interface InputRichBlockSectionHeading { type: "heading"; text: RichText; size: 1|2|3|4|5|6 }
interface InputRichBlockBlockQuotation { type: "blockquote"; blocks: InputRichBlock[]; credit?: RichText }
interface InputRichBlockExpandableBlockQuotation { type: "expandable_blockquote"; text: RichText; credit?: RichText }
```

### 1.2 Methods

- `sendRichMessage({ chat_id, rich_message: InputRichMessage, ... })` → returns the sent `Message` (has `message_id`).
- `editMessageText` — signature is `(text: string | InputRichMessage, other?)` on the context
  alias and `(chat_id, message_id, text | InputRichMessage, other?)` on `ctx.api`; an
  `InputRichMessage` object is sent as `rich_message` and **replaces** the message content.
- Button presses arrive as **ordinary `callback_query` updates** (same as inline keyboards). You MUST call `answerCallbackQuery` or the client shows a spinner forever.

### 1.3 grammY conveniences **[verified in practice]**

- `ctx.replyWithRichMessage(richMessage, other?)` → `api.sendRichMessage`.
- `ctx.editMessageText(stringOrObject)` — a **string** maps to `text`, an **`InputRichMessage` object** maps to `rich_message`.
- `bot.callbackQuery(regexOrString, handler)` + `ctx.answerCallbackQuery(...)`.
- ⚠️ **`ctx.match` is typed `string | RegExpMatchArray`** — with a regex trigger it is a match
  array at runtime, but you must cast (`ctx.match as RegExpMatchArray`) or narrow before
  indexing groups, or `strict` TS rejects it.
- Session plugin default key (verified): `ctx.chatId?.toString()` → **per-chat session = per-chat game, structurally**.
- `lazySession` exists; access is `await ctx.session`. `LazySessionFlavor<S>` is the flavor type.

### 1.4 Hard limits (from official docs, verified)

| Limit | Value | Our worst case |
|---|---|---|
| Rich message text | 32,768 UTF-8 chars | ~300 chars ✓ |
| Blocks (table **rows count**) | 500 | ~18 ✓ |
| Nesting levels | 16 | 3 ✓ |
| Table columns | **20** | 12 (Hard) ✓ |
| Buttons per `buttons` block | **8** | 3 ✓ |
| `callback_data` | **64 bytes** | 15 (`ms:xxxx:c:11:11`) ✓ |
| Free storage: per session key | **16 KiB** | < 1 KiB ✓ (measured: a Hard game stores well under 1 KiB) |
| Free storage: session key length | 64 chars | ~14 (chat id) ✓ |
| Free storage: sessions per bot | 50,000 | = 50k chats |

Known unknown: no documented cap on *total* in-cell buttons per message. Production chess bots ship 64+; Hard mode uses 144. If a server cap surfaces during testing, shrink Hard to 10×12 — the architecture doesn't change.

---

## 2. Game design

### 2.1 Rules mapped to the medium

- **Difficulties:** Easy 8×8, 10 mines · Medium 10×10, 15 mines · Hard 12×12, 24 mines. No coordinate header row/col (unneeded for minesweeper; saves width). ~12 columns is the practical phone-width ceiling.
- **No long-press exists → mode toggle.** A control-row button toggles ⛏️ Dig ↔ 🚩 Flag mode for the whole board. Its `style` flips (`primary` when digging, `success` when flagging) so the active mode is always visible.
- **First-click safety:** mines are placed only after the first dig, excluding the dug cell and its 8 neighbors. Cleanest ownership: `dig()` itself places mines when `!minesPlaced` (and stamps `startedAt`, flips phase to `"playing"`), with `placeMines` still exported for tests.
- **Flood fill** on zero cells — **iterative** (explicit stack), never recursive. Flood **skips flagged cells** (classic behavior — a wrong flag can therefore block a win until unflagged).
- **Win:** `revealedCount === rows*cols − mines`.
- **Testability:** engine functions take an injectable `rng: () => number` (default
  `Math.random`) and `dig` takes an optional `now` — deterministic tests need both.

### 2.2 Cell rendering states

| State | Rendering |
|---|---|
| Covered, game live | callback button `⬜`, data `ms:<nonce>:c:<r>:<c>` |
| Flagged, game live | callback button `🚩` (same data; engine interprets by mode) |
| Revealed, n > 0 | plain **bold** digit (`{ type: "bold", text: "3" }`) |
| Revealed, n = 0 | `" "` (single space) |
| Game over, covered/flagged non-mine | **`disabled` button** (keeps grid geometry stable) |
| Game over, mine | `💥` if it was the fatal cell, else `💣` (plain text); a **flagged** mine keeps its 🚩 as a disabled button |

Misclick protection: digging a flagged cell in Dig mode is a no-op with toast "Unflag it first".

Optional polish (build last): chording — render revealed digits as `style: "link"` callback buttons (borderless, looks like text); tapping when adjacent flags == digit reveals remaining neighbors.

### 2.3 Message layout (top to bottom)

1. `paragraph` — status line: `💣 10 · 🚩 3 · ⏱ 1:42 · game by <name>`
   ⚠️ Displaying a name means **storing a name**: add `startedByName` to both `GameState`
   and `StoredGame` (a bare user id renders badly, and `ctx.from` isn't available at render
   time). Capture `ctx.from.first_name` at game creation.
2. `table` — the board (`is_compact: true`)
3. `blockquote` — only when finished: **🏆 You win! 🎉** / **💥 Boom — you hit a mine.** / **🏳️ Game over — you gave up.**
4. `buttons` — controls:
   - live: `[⛏️ Digging|🚩 Flagging] [🔄 New] [🏳️ Give up (danger)]`
   - finished: `[🔄 Play again (primary)]`
5. `expandable_blockquote` — how-to-play + per-chat stats (wins/losses/best times)

A **frozen** copy (superseded board, see §2.5) renders all cells as disabled buttons and
replaces blocks 4–5 with a paragraph: "⤵️ This board moved — use the latest message."

### 2.4 One game per chat (core invariant)

State lives in the grammY **session** (default key = chat id) as `game: StoredGame | null`. One chat ⇒ one session ⇒ at most one game. Persisted in **free storage**, so games survive bot restarts.

Lifecycle:

```
game:null ──/new──▶ difficulty picker ──tap──▶ ACTIVE (exactly one live board message)
ACTIVE ──win/boom/give-up──▶ FINISHED (frozen board + Play again; stats updated)
ACTIVE ──/new──▶ board REPOSTED as fresh message (old copy frozen best-effort)
FINISHED/ACTIVE ──new game──▶ replaced (old message frozen best-effort)
```

- `/new` with no active game → difficulty picker. `/new` mid-game → **repost** the current board (useful when buried in group chat); abandoning is only via explicit 🏳️ Give up (counts as a loss).
- The 🔄 New **button** mid-game replaces the game (same difficulty, fresh nonce + fresh
  message) **without** counting a loss; set the old game's phase to `"quit"` *only for the
  frozen rendering* so the old copy draws as ended.
- **Finished game stays in session** (not nulled) so the frozen board's "Play again" nonce still resolves; it's replaced when the next game starts.
- **Groups are co-op:** any member can tap (the game belongs to the chat; owner-locking would let an AFK user squat the chat's only slot). Mode toggle is shared board-wide state — acceptable, like a physical shared board. `startedBy`/`startedByName` kept for display/stats.

### 2.5 Staleness guards (both required, both cheap)

1. **nonce** (4 chars, baked into every `callback_data`): mismatch ⇒ tap on an older/replaced game ⇒ toast "That game is over — /new".
2. **messageId** (stored in session): mismatch ⇒ same game but a superseded board copy (repost case — old copies share the nonce) ⇒ toast "Board moved — use the latest message".

### 2.6 Callback protocol (all ≤ 64 bytes)

| Data | Meaning |
|---|---|
| `ms:<nonce>:c:<r>:<c>` | act on cell (dig or flag per current mode) |
| `ms:<nonce>:m` | toggle dig/flag mode |
| `ms:<nonce>:n` | new game, same difficulty |
| `ms:<nonce>:q` | give up → reveal board, record loss |
| `ms:diff:<easy\|medium\|hard>` | difficulty picker (pre-game, nonce-free — must work when `game` is null) |

Router regexes: `/^ms:diff:(easy|medium|hard)$/` and `/^ms:(\w{4}):([cmnq])(?::(\d+):(\d+))?$/`.

Parse into a **discriminated union with one literal `kind` per member**:

```ts
type Action =
  | { kind: "cell"; nonce: string; r: number; c: number }
  | { kind: "mode"; nonce: string }
  | { kind: "new";  nonce: string }
  | { kind: "quit"; nonce: string };
// NOT { kind: "mode" | "new" | "quit"; … } — a union *inside* one member
// breaks TS narrowing on `action.kind === "cell"`. This bit for real.
```

---

## 3. Project structure (as actually built)

```
tg-minesweeper/
├─ deno.json             # tasks, import map (grammy, grammy/types, jsr deps), lock:false
├─ .env.example          # BOT_TOKEN=
├─ .gitignore            # .env, deno.lock
├─ README.md
├─ PLAN.md               # this file
├─ src/
│  ├─ bot.ts             # entry: Bot<MyContext>, lazySession + freeStorage, wiring, bot.start()
│  ├─ context.ts         # MyContext, SessionData, ChatStats, initialSession()
│  ├─ codec.ts           # callback_data build/parse + Action union + router regexes
│  ├─ game/
│  │  ├─ types.ts        # GameState (runtime), StoredGame (persisted), DIFFICULTIES
│  │  ├─ engine.ts       # PURE logic — zero grammy imports (unit-testable)
│  │  └─ store.ts        # hydrate/dehydrate StoredGame ⇄ GameState
│  ├─ render/
│  │  ├─ rich.ts         # tiny typed builders: para(), heading(), buttonsRow(), cbBtn(), disabledBtn(), banner()
│  │  └─ board.ts        # renderGame(state, stats, {frozen?, now?}): InputRichMessage — PURE
│  └─ handlers/
│     ├─ commands.ts     # /start /new /help
│     ├─ callbacks.ts    # the two callbackQuery routers + applyAction logic
│     └─ freeze.ts       # freezeOldBoard() — separate file so commands.ts and
│                        #   callbacks.ts can share it without a circular import
└─ tests/
   ├─ helpers.ts         # seededRng (mulberry32), setMines(board fixture)
   ├─ engine_test.ts
   ├─ store_test.ts
   ├─ codec_test.ts
   └─ board_test.ts
```

---

## 4. Data model

```ts
// game/types.ts
export type Difficulty = "easy" | "medium" | "hard";
export type Phase = "fresh" | "playing" | "won" | "lost" | "quit";
export type Mode = "dig" | "flag";

// Runtime model — what engine + renderer consume
export interface Cell { mine: boolean; revealed: boolean; flagged: boolean; adjacent: number; exploded?: boolean }
export interface GameState {
  nonce: string; messageId: number; startedBy: number; startedByName: string;
  difficulty: Difficulty; rows: number; cols: number; mines: number;
  board: Cell[][]; phase: Phase; mode: Mode;
  minesPlaced: boolean; flags: number; revealedCount: number; startedAt?: number;
}

// Persisted model — compact, < 1 KiB (16 KiB budget)
export interface StoredGame {
  nonce: string; messageId: number; startedBy: number; startedByName: string;
  difficulty: Difficulty; rows: number; cols: number; mines: number;
  cells: string;          // rows*cols chars of "0"–"7": bit1=mine, bit2=revealed, bit4=flagged
  phase: Phase; mode: Mode; minesPlaced: boolean; startedAt?: number;
}

// context.ts
export interface ChatStats { wins: number; losses: number; bestMs: Partial<Record<Difficulty, number>> }
export interface SessionData { v: 1; game: StoredGame | null; stats: ChatStats }
export type MyContext = Context & LazySessionFlavor<SessionData>;
```

Rules:
- **Never persist computed fields** (`adjacent`, `flags`, `revealedCount`) — `hydrate()` recomputes them, so stored state cannot go internally inconsistent.
- `exploded` (the fatal-cell marker) is deliberately **not** persisted — it only matters for
  the single render performed in the same update that set it. A later re-render from storage
  shows 💣 instead of 💥; cosmetic, accepted.
- `SessionData.v` is a schema version for future migrations (check-and-migrate in a tiny middleware if it ever bumps).
- `initial()` must return a **fresh object** per call (session plugin rule).

---

## 5. Key implementation sketches

### 5.1 Session wiring (`bot.ts`) **[updated — adapter shim required]**

```ts
import { Bot, lazySession } from "grammy";
import { freeStorage } from "@grammyjs/storage-free";
import { initialSession, type MyContext, type SessionData } from "./context.ts";

const token = Deno.env.get("BOT_TOKEN");
if (!token) { console.error("BOT_TOKEN environment variable is required"); Deno.exit(1); }

const bot = new Bot<MyContext>(token);

// ⚠️ storage-free's readAllKeys() returns Promise<string[]>, but current grammY
// types StorageAdapter.readAllKeys() as Iterable | AsyncIterable — direct
// assignment is a type error. Expose only the three methods the session
// plugin actually uses:
const free = freeStorage<SessionData>(bot.token);
bot.use(lazySession({
  initial: initialSession,
  storage: {
    read: (key) => free.read(key),
    write: (key, value) => free.write(key, value),
    delete: (key) => free.delete(key),
  },
}));
// NOTE: lazySession (not session) — free storage is a remote HTTP service; lazy means
// ordinary group chatter never touches storage, only handlers that `await ctx.session`.
// If ever migrating to @grammyjs/runner or webhooks (concurrent updates), add:
//   bot.use(sequentialize((ctx) => ctx.chatId?.toString()));
// Default bot.start() long polling is sequential — no session races out of the box.

bot.use(commands);
bot.use(callbacks);
bot.catch((err) => console.error("bot error", err.error));
await bot.api.setMyCommands([
  { command: "new", description: "Start a game (or repost the current board)" },
  { command: "help", description: "How to play" },
]);
bot.start();
```

### 5.2 Pure engine (`game/engine.ts`) — no Telegram imports

```ts
type Rng = () => number;                              // injectable, default Math.random
createGame(difficulty, startedBy, startedByName, rng?): GameState   // nonce = 4 base36 chars; phase "fresh"
placeMines(g, safeR, safeC, rng?): void               // excludes safe cell + 8 neighbors; partial Fisher–Yates; computes `adjacent`
computeAdjacents(g): void                             // exported — hydrate() and test fixtures need it
dig(g, r, c, rng?, now?): "ok" | "boom" | "win" | "noop"
  // auto-places mines on first dig; ITERATIVE flood fill (explicit stack);
  // noop on flagged/revealed/out-of-bounds/finished
toggleFlag(g, r, c): "ok" | "noop"
resign(g): "ok" | "noop"                              // phase = "quit"; renderer reveals mines
checkWin(g): boolean                                  // revealedCount === rows*cols - mines
isOver(g): boolean                                    // phase ∈ {won, lost, quit}
```

### 5.3 Renderer core (`render/board.ts`)

```ts
import type { InputRichMessage, InputRichBlock, RichBlockTableCell,
              RichMessageButton, RichText } from "grammy/types";

// Signature grew two options vs the original plan:
//   renderGame(g, stats, opts?: { frozen?: boolean; now?: number })
// `frozen`: all-disabled rendering for superseded copies; `now`: clock injection for tests.

function cellContent(g: GameState, r: number, c: number, frozen: boolean): RichText {
  const cell = g.board[r][c];
  const over = isOver(g);
  if (over && cell.mine && !cell.flagged) return cell.exploded ? "💥" : "💣";
  if (cell.revealed)
    return cell.adjacent === 0 ? " " : { type: "bold", text: String(cell.adjacent) };
  const label = cell.flagged ? "🚩" : "⬜";
  const button: RichMessageButton = over || frozen
    ? { text: label, disabled: {} }
    : { text: label, callback_data: cbCell(g.nonce, r, c) };
  return { type: "button", button };
}

function boardTable(g: GameState, frozen: boolean): InputRichBlock {
  return {
    type: "table",
    is_compact: true,
    cells: g.board.map((row, r) => row.map((_, c): RichBlockTableCell => ({
      text: cellContent(g, r, c, frozen),
      align: "center",   // align/valign are REQUIRED fields — set on every cell
      valign: "middle",
    }))),
  };
}
// renderGame assembles: status paragraph · table · phase banner (won/lost/quit) ·
// controls buttons-row (or "board moved" paragraph when frozen) ·
// expandable_blockquote help+stats (omitted when frozen).
// Also export renderDifficultyPicker() and renderHelp().
```

### 5.4 Handlers (`handlers/`)

```ts
// commands.ts — /new: picker when idle, repost when a game is live
commands.command(["start", "new"], async (ctx) => {
  const s = await ctx.session;
  if (s.game && (s.game.phase === "playing" || s.game.phase === "fresh")) {
    const g = hydrate(s.game);
    const old = s.game.messageId;
    const sent = await ctx.replyWithRichMessage(renderGame(g, s.stats));
    s.game.messageId = sent.message_id;                 // new copy is authoritative
    freezeOldBoard(ctx, old, g, s.stats);               // best-effort, .catch(() => {}) inside
    return;
  }
  await ctx.replyWithRichMessage(renderDifficultyPicker());
});

// callbacks.ts — difficulty picker (nonce-free; morphs picker message into the board)
callbacks.callbackQuery(DIFF_RE, async (ctx) => {
  const s = await ctx.session;
  const g = createGame(ctx.match[1] as Difficulty, ctx.from.id, ctx.from.first_name);
  g.messageId = ctx.msg?.message_id ?? 0;
  await ctx.editMessageText(renderGame(g, s.stats));   // object ⇒ rich_message
  s.game = dehydrate(g);
  await ctx.answerCallbackQuery();
});

// callbacks.ts — game actions
callbacks.callbackQuery(ACTION_RE, async (ctx) => {
  const s = await ctx.session;
  const stored = s.game;
  const action = parseAction(ctx.match as RegExpMatchArray);  // cast needed, see §1.3
  if (!stored || stored.nonce !== action.nonce)
    return ctx.answerCallbackQuery({ text: "That game is over — /new to play" });
  if (ctx.msg?.message_id !== stored.messageId)
    return ctx.answerCallbackQuery({ text: "Board moved — use the latest message" });

  const g = hydrate(stored);

  // "new" needs ctx (sends a message) — handle before the pure dispatch:
  if (action.kind === "new") {
    const fresh = createGame(g.difficulty, ctx.from.id, ctx.from.first_name);
    const sent = await ctx.replyWithRichMessage(renderGame(fresh, s.stats));
    fresh.messageId = sent.message_id;
    s.game = dehydrate(fresh);
    if (!isOver(g)) g.phase = "quit";       // frozen render shows "ended"; NOT counted as a loss
    freezeOldBoard(ctx, stored.messageId, g, s.stats);
    return ctx.answerCallbackQuery();
  }

  const wasOver = isOver(g);
  const toast = applyAction(g, action);     // mode toggle / resign / dig-or-flag per mode
  if (!wasOver && isOver(g)) updateStats(s.stats, g, Date.now());  // wins/losses/bestMs
  s.game = dehydrate(g);                    // finished game stays in session (Play-again nonce)

  try { await ctx.editMessageText(renderGame(g, s.stats)); }
  catch (e) {
    if (!(e instanceof GrammyError && e.description.includes("message is not modified"))) throw e;
  }
  await ctx.answerCallbackQuery(toast ? { text: toast } : {});
});
```

`applyAction` notes:
- `c` in Dig mode: digging a flag ⇒ noop + "Unflag it first"; boom ⇒ "💥 Boom!"; win ⇒ "🏆 You win!". (First-dig mine placement lives inside `dig()`.)
- `c` in Flag mode: `toggleFlag` (revealed cells noop).
- `m`: toggle mode, toast the new mode.
- `q`: `resign(g)`.
- Guard every branch with `isOver(g)` — a finished game's only live control is Play again, but taps can still race in.

---

## 6. Pitfalls checklist (bite-avoidance — ✅ = actually bit or was verified during implementation)

1. ✅ `align`/`valign` are **required** on every `RichBlockTableCell` — set both, always.
2. Button `text` = plain text + emoji only. No `{ type: "bold" }` inside button labels.
3. `style: "link"` only on callback buttons (matters only for the chording extra).
4. Buttons block max **8** buttons; table max **20** columns; table rows count toward the **500-block** cap.
5. **Always** `answerCallbackQuery`, even on no-ops — otherwise the client spinner hangs. Answer *after* the edit so the spinner doubles as feedback.
6. Swallow `"message is not modified"` `GrammyError` (expected on no-op taps); rethrow everything else.
7. `lazySession` ⇒ **`await ctx.session`** everywhere. The `LazySessionFlavor` type makes forgetting it a compile error.
8. One re-render per action (flood fill = still one edit), renderer is a pure function of state.
9. Uniform-width glyphs for tappable states (`⬜`/`🚩` both emoji-width) so columns don't wobble.
10. `sendRichMessageDraft` is irrelevant here (ephemeral 30-s AI-streaming preview, private chats only) — do not use.
11. Do not store per-user data in the session — it is per-chat by design.
12. ✅ `hydrate(dehydrate(g))` must be identity (modulo recomputed fields) — enforce with a property test over random play sequences.
13. Free storage can fail transiently (remote HTTP) — `bot.catch` logs, user retries the tap. The adapter implements grammY's standard `StorageAdapter` shape (modulo pitfall 15), so swapping to Redis/KV later is localized to `bot.ts`.
14. ✅ **`ctx.match` needs a cast** to `RegExpMatchArray` under strict TS (§1.3).
15. ✅ **storage-free ↔ StorageAdapter type mismatch** on `readAllKeys` — wrap with a
    three-method object (§5.1). Do not `as any` the whole adapter.
16. ✅ **Discriminated unions need one literal `kind` per member** (§2.6) — a union-typed
    `kind` inside one member silently kills narrowing.
17. ✅ **`mod.ts` does not export the API types** — map `grammy/types` to `src/types.ts`.
18. ✅ **Moving tag ⇒ no lockfile** (`"lock": false`) or pin an exact tag.
19. ✅ **Test-fixture trap:** with only 1–2 mines on a small board, digging any zero cell
    floods the entire board and **wins instantly** — mid-game fixtures must dig a *numbered*
    cell (one adjacent to a mine) to stay in `"playing"`.
20. ✅ Keep `freezeOldBoard` in its own module — both `commands.ts` and `callbacks.ts` need
    it, and putting it in either creates a circular import.

---

## 7. Build order & acceptance criteria

0. **Verify the API surface from the fetched source first** (§0.2). Ten minutes, prevents days.
1. **Engine + tests** (`Deno.test` + `@std/assert`, seeded mulberry32 RNG): first-click safety across many seeds (safe cell + 8 neighbors never mined, exact mine count) · adjacency consistency · flood fill on fixed layouts (full zero region + numbered border; does not cross numbers; skips flags) · boom marks `exploded` and locks the game · win detection · flag/unflag invariants · resign · out-of-bounds noops. Engine must import nothing from grammy.
2. **Store + tests:** `hydrate(dehydrate(g))` identity as a property test over random play; all 8 cells-string bit combos; stored JSON size < 1 KiB.
3. **Renderer + structural tests** (no snapshot infra needed — assert structure directly): mid-game board (live buttons, status-line text, control count) · lost board (💥 on fatal cell, flagged mine keeps 🚩 disabled, geometry stable, single Play-again) · won banner · frozen board has zero live buttons · Hard board: 12×12 ≤ 20 cols, ≥144 callback buttons · every message passes the limit walk (cols ≤ 20, buttons ≤ 8/block, all cells have align/valign, all `callback_data` ≤ 64 bytes).
4. **Bot wiring, long polling:** manual verification on a real chat (needs a real BOT_TOKEN — cannot be automated from CI) —
   - picker morphs into board; taps dig/flag; mode toggle restyles; win/boom banners render;
   - game over freezes cells as disabled buttons (grid geometry unchanged);
   - `/new` mid-game reposts; taps on the old copy toast "Board moved";
   - **restart the bot mid-game** ⇒ board still responds (free-storage persistence proof);
   - second chat has a fully independent game (per-chat isolation proof);
   - verify Hard 12×12 renders and its 144 in-cell buttons all work on a phone client.
5. **Polish (optional):** chording via link-style digit buttons · `@grammyjs/auto-retry` + throttler if group co-op gets bursty.

Result of steps 0–3 in this repo: 25 tests, all passing; `deno task check` clean.

## 8. Dependencies (Deno — no package.json)

Everything lives in the `deno.json` import map (§0.1):

- `grammy` → `https://cdn.jsdelivr.net/gh/grammyjs/grammy@1/src/mod.ts` (project requirement; `@1` = latest 1.x, resolved to 1.45.1 at build time)
- `grammy/types` → same repo, `src/types.ts`
- `jsr:@grammyjs/storage-free@^2.6.0`
- `jsr:@std/assert@^1.0.0` (tests only)

Env: `BOT_TOKEN` (from @BotFather).
Run: `deno task start` · Test: `deno task test` · Type-check: `deno task check`.
All three need network access to cdn.jsdelivr.net, jsr.io, and cdn.skypack.dev (hence `--allow-import`).
