# Mighty Fooding Time

*Unofficial fan project, not affiliated with Nintendo — see License at the bottom.*

Five WarioWare-inspired microgames decide what you eat.

You play. The server tracks how badly it went. An LLM reads your performance and
sentences you to 3 real nearby restaurants, with commentary. Every restaurant is
pulled live from Google Places — name, address, rating, a photo, a Google Maps
link. Nothing is invented: no fake restaurants, no invented dish (Places doesn't
expose menu items, so this app never claims to know one).

Built as a practice project for **async communication patterns** (WebSockets,
streaming, callbacks) plus an LLM integration, with an actual payoff at the end.

**Status:** all 5 microgames working, WebSocket protocol and AI grounding both
verified live (see `misc/decision-log.md` for the history), difficulty still
untuned. No offline/fallback mode by design — see "Run it" below.

---

## Run it

**Prerequisites:** Node.js 22+ (uses native `fetch` and ESM throughout, no
bundler), an OpenAI API key, and a Google Cloud API key with "Places API
(New)" enabled.

```bash
npm install          # once
cp .env.example .env # then fill in OPENAI_API_KEY and GOOGLE_MAPS_API_KEY
npm start            # -> http://localhost:3000
```

`.env` is gitignored. `GET /api/health` reports which keys are missing, if any,
without exposing them.

**Both `OPENAI_API_KEY` and `GOOGLE_MAPS_API_KEY` are required.** There is no
offline/fallback mode — if either is missing, or Google Places can't find a
real restaurant nearby, the run ends on a game-over screen instead of showing
invented data.

Headless test of the whole flow, no clicking required:

```bash
npm start            # terminal 1
npm run test:loop    # terminal 2 — plays a scripted run, prints the protocol trace
```

---

## Architecture

```
server/
  server.js          Express + WebSocket server. Drives the game sequence.
  gameSession.js     Session state, shuffle, outcomes, trait extraction.
  decisionEngine.js  Traits -> restaurant verdict via OpenAI Responses API (streaming).
  googlePlaces.js     Real restaurant lookup (Places Text Search), plain HTTP.
public/
  index.html         Layout + DOM screens layered over the canvas.
  client.js          WebSocket client + Phaser bootstrap + screen switching.
  games/base.js      The contract every microgame follows.
  games/*.js         One file per microgame.
scripts/
  protocol-test.mjs  Headless client that plays a scripted run.
```

### The async story

Three different flavours of async, on purpose:

**1. WebSockets — the server pushes, the client reacts.**
The browser never asks "what's next?". It connects once; the server sends
`load_game` when it's time to play, `outcome_ack` after each result, and
`recommendation` at the end. Shuffle order, scoring, and secret conditions all
live server-side — the browser is a rendering surface that reports what
happened. That's why multiplayer would be an additive change, not a rewrite.

**2. Streaming + callback injection.**
`decisionEngine.js` iterates the Responses API event stream and calls
`onToken(text)` for each `response.output_text.delta`. It has never heard of
WebSockets — `server.js` supplies a callback that pushes each fragment down the
socket. That indirection is why the same engine works unchanged in the headless
test, and would work behind SSE or in a CLI.

**3. Event-driven game code.**
Phaser input handlers, timers, the countdown loop, and the WebSocket `message`
handler are all callbacks. `handleMessage()` is a `switch` on message type with
per-connection state — effectively an actor with a typed inbox.

### Protocol

```
client -> server
  { type: 'start' }
  { type: 'game_result', gameId, result, meta }
  { type: 'restart' }

server -> client
  { type: 'session_started', sessionId, totalGames }
  { type: 'load_game', game: {id,title,prompt,durationMs,index,total} }
  { type: 'outcome_ack', gameId, result, score, index, total }
  { type: 'thinking_start', profile }
  { type: 'thinking_token', text }
  { type: 'recommendation', payload, profile }
  { type: 'game_over', message }   // no fallback data exists — recommendation failed outright
  { type: 'error', message }       // protocol-level error (bad message, no active session, etc.)
```

Plus a 30-second ping/pong heartbeat that reaps dead connections.

### The AI pattern worth keeping

The model never sees raw game events. `gameSession.buildProfile()` does
deterministic feature extraction first — outcomes become traits like
`NO_IMPULSE_CONTROL` or `FLAWLESS_RUN` — and only those reach the prompt.

Reliable, testable logic in code. Creativity in the model. That split is most of
what makes LLM features predictable in production.

The model replies in a line-based contract (`VERDICT:`, `REASON_1:`, `REASON_2:`,
`REASON_3:`, `DARE:`) rather than JSON, because it streams legibly — you watch
it fill in live. `parseVerdict()` reads it back and zips `REASON_1..3` onto the
3 real restaurants the tool returned, in the order the tool returned them — the
restaurant identity is never something the model can invent, only the reasoning
text attached to it. If a REASON line is missing, that restaurant just renders
with an empty reason rather than falling back to invented text. The tradeoff:
structured outputs would give schema guarantees but lose the typewriter effect.
Worth trying both and deciding.

**On model choice:** a run costs ~400 input + ~120 output tokens — about a tenth
of a cent even on a flagship. This is a workload where quality should drive the
choice, not price; the reflex to reach for the cheap model is right for
high-volume classification and wrong here. Set `OPENAI_MODEL` in `.env` and A/B
a few — "which verdict is actually funnier" is a legitimate eval.

---

## The microgames

| Game | Win by | Hidden behaviour |
|---|---|---|
| MASH! | 22 taps before time runs out | 40+ taps reads as `FERAL_ENERGY` |
| DODGE! | surviving the falling blocks | — |
| REPEAT! | replaying a 3-arrow pattern | — |
| DON'T TOUCH IT! | doing absolutely nothing | hovering it the whole round without clicking = **secret outcome** |
| ODD ONE OUT! | clicking the mismatched food | — |

### Adding a sixth game

1. Add an entry to `GAME_CATALOG` in `server/gameSession.js`.
2. Create `public/games/yourGame.js` extending `BaseGameScene`, implement
   `setup()`, call `this.finish('success' | 'fail' | 'secret', meta)`.
3. Register it in the `SCENES` map in `public/client.js`.

Timer, prompt banner, win/lose flash, and result reporting come free from the
base class.

---

## Pick up here

### 1. Tune difficulty
Every number was picked blind and none survived contact with a player:
- `MashScene.target = 22` taps in 5s
- `SimonScene` — 3-arrow sequence in 8s
- `DodgeScene` — 260ms spawn interval, speeds 240-380
- `DontTouchScene` — hover >60% of the round for the secret

### 2. Housekeeping
`public/assets/` is empty; everything is drawn with Phaser primitives and
system fonts. Sound would add a lot — WarioWare is half audio.

Still open, worth doing before making the repo public:
- A screenshot or short GIF of a run in the README — nothing here shows
  what it actually looks like yet.
- Repo description + topics on GitHub itself (`gh repo edit --description
  ... --add-topic ...`) — helps it read as a finished project, not a dump.
- Third-party attribution: Phaser (MIT, loaded via CDN in `index.html`) and
  the Bungee / Space Grotesk Google Fonts (both OFL-licensed) — fine to use
  as-is, just worth a line crediting them if this goes public.

---

## License

[MIT](./LICENSE) — the original code in this repo, free to use, modify, and
redistribute.

**Not affiliated with, endorsed by, or sponsored by Nintendo.** "WarioWare"
is a trademark of Nintendo Co., Ltd.; this is an original homage to its
microgame format, referenced only as inspiration — no Nintendo characters,
sprites, audio, text, or code appear anywhere in this repo. Every visual is
drawn from Phaser primitives and system/Google fonts, and every line of game
logic is original. "Mighty Fooding Time" is this project's own name, not a
Nintendo product. The MIT license above covers the original code only; it
doesn't and can't extend to Nintendo's trademark or any other third-party IP.

---

## More context

Design decisions, dated verification notes, and hosting research live in a
local `misc/` folder — gitignored on purpose, so it won't be here if you
cloned this from GitHub:
- `misc/decision-log.md` — what was tried, ruled out, and verified, and when.
- `misc/vercel-hosting-research.md` — why Render, not Vercel, is the free-tier
  pick for this app (not deployed yet either way).
