# Mighty Fooding Time

> **Unofficial fan project — not affiliated with, endorsed by, or sponsored by
> Nintendo.** "WarioWare" is a trademark of Nintendo Co., Ltd. This is an
> original homage to its microgame format: no Nintendo characters, sprites,
> audio, text, or code appear anywhere here. Every visual is drawn from Phaser
> primitives and system/Google fonts; every line of game logic is original.
> "Mighty Fooding Time" is this project's own name, not a Nintendo product.

Five WarioWare-inspired microgames decide what you eat.

You play. The server tracks how badly it went. An LLM reads your performance and
sentences you to 3 real nearby restaurants, with commentary. Every restaurant is
pulled live from Google Places — name, address, rating, a photo, a Google Maps
link. Nothing is invented: no fake restaurants, no invented dish (Places doesn't
expose menu items, so this app never claims to know one).

Built as a practice project for **async communication patterns** (WebSockets,
streaming, callbacks) plus an LLM integration, with an actual payoff at the end.

---

## Status at handoff

| Piece | State |
|---|---|
| Game loop, all 5 microgames | Working, confirmed in browser |
| WebSocket protocol, session state, scoring | Working, verified by `npm run test:loop` |
| Secret-condition detection | Working, verified in the headless test |
| **Real OpenAI call (Responses API)** | **Verified working** — see below |
| **Real restaurant grounding (Google Places)** | **Verified working** — see below |
| Difficulty tuning | **Untuned** — numbers were picked blind |
| git / GitHub | Initialized, pushed to a private repo |

**No offline mode.** Earlier versions fell back to a local rules table when a
key was missing, and invented a plausible restaurant when ungrounded. Both
were removed on purpose — this app either shows a real, grounded
recommendation or a game-over screen; it never shows made-up restaurants.
`streamRecommendation()` throws if `OPENAI_API_KEY` or `GOOGLE_MAPS_API_KEY`
is missing, or if Places can't find anything nearby, and `server.js` turns
that into a `{ type: 'game_over' }` message.

**OpenAI path — verified 2026-09-03.** Ran `npm run test:loop` against the live
Responses API with a real key: streamed correctly, model ID resolved, output
parsed into the `VERDICT/REASON_1/REASON_2/REASON_3/DARE` contract. One real
bug found and fixed along the way: the follow-up turn after a tool call
(chained via `previous_response_id`) doesn't inherit `instructions` — the
OpenAI SDK is explicit that instructions never carry across chained
responses. That turn was going out with no persona/format instructions at
all, which is why the model free-wrote markdown instead of the contract.
Fixed by re-passing `instructions` on every turn, not just the first.

**Grounding pivoted away from delivery-app MCP servers entirely — see "Why not
Uber Eats/DoorDash MCP" below.** `decisionEngine.js` grounds via a plain
function tool, `find_real_restaurants` (implemented in `googlePlaces.js`),
instead of an MCP `tools` entry. MCP tools are executed by OpenAI's own
infrastructure, but a custom function tool is executed by *us* — the model
pauses mid-stream, we run the actual Google Places HTTP call (Text Search,
returning up to 3 results with name/address/rating/photo/Maps link), and send
the result back as a new turn (`previous_response_id` + `function_call_output`)
before the model keeps generating. **Verified 2026-09-03** against a real
`GOOGLE_MAPS_API_KEY` — confirmed independently by calling
`findRestaurants()` directly (bypassing the model) and diffing its output
against what the model wove into its reasons.

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

### 2. ~~Verify the Google Places grounding path live~~ — done
Verified 2026-09-03 against real credentials: the tool call returns real
restaurants, `[checking real restaurants nearby…]` shows in the trace, and a
direct call to `findRestaurants()` (bypassing the model entirely) confirmed
the data isn't hallucinated. Since then this got reworked further: it now
returns 3 restaurants per run instead of 1, drops the invented `DISH` field
entirely, adds photos (`GET /api/place-photo` proxies the Places Photo (New)
endpoint so the API key never reaches the browser), a real Google Maps link
per restaurant, and removed both fallback paths (no-OpenAI-key, no-Maps-key) —
a missing key or a failed lookup now ends the run on a game-over screen
instead of showing invented data.

Cost is a non-issue at this scale: Text Search has a monthly free tier, and a
personal project's traffic won't come close to it. Place Photo billing is
separate from Text Search — check current pricing/quota for it in Cloud
Console before assuming it's free, since every restaurant card now loads one.
If you want a hard ceiling anyway, set a **quota** (not just a billing alert)
on the Places API in Cloud Console — quotas actually block excess calls,
alerts just notify you after the fact.

### 3. Why not Uber Eats / DoorDash MCP (settled, don't re-litigate)
Checked 2026-09-03, thoroughly. Short version: **no official food-delivery MCP
server currently accepts a new client, period** — not just this one:

- **Uber Eats** (`mcp.ubereats.com/eats-claude/mcp`): no `registration_endpoint`
  (no Dynamic Client Registration), direct requests get a flat `403`, and
  OpenAI's own infrastructure attempting the handshake server-side got
  `424 Failed Dependency` listing tools. Its OAuth metadata is also missing a
  required field (`response_types_supported`), which crashes Claude Code's
  login flow before a browser even opens — this isn't "gated to approved
  clients," the discovery document is broken for everyone.
- **DoorDash** (`openapi.doordash.com/mcp/consumer`): server is alive and its
  metadata is well-formed, but `registration_endpoint` is present and
  explicitly empty. Confirmed directly: `claude mcp login doordash` (a
  legitimate, "approved" client type) was refused — `Incompatible auth
  server: does not support dynamic client registration`. Not gated to
  outsiders; not accepting *anyone* right now.
- **Zomato** (`mcp-server.zomato.com`): the one exception — real DCR support,
  well-formed metadata, genuinely open to any client. Useless here anyway:
  Zomato doesn't operate in Canada/the US.

**Also ruled out: community browser-automation servers** (e.g.
`ericzakariasson/uber-eats-mcp-server` — Playwright driving a real logged-in
session, including clicking "Place order"). Technically works, but real
consumer platforms run bot detection and prohibit automated access in their
ToS; the account that gets flagged is your real Uber account, shared with
Rides. Not worth the risk for a portfolio project. If revisited, do it against
a throwaway account, run manually/rarely, and never let `order_food` fire
without an explicit human click.

**Conclusion:** grounding via a delivery app's own API is off the table for
now, for structural reasons outside this codebase, not fixable by switching
providers (OpenAI vs. Claude API — same request shape, same missing
`client_id` problem) or writing more code. Google Places (see above) is the
replacement: real restaurant, no OAuth, no bot-detection risk, effectively
free at this scale. It doesn't return real menu items — there is no
delivery-app API in the loop to get one from — so this app doesn't claim to
recommend a dish at all anymore. It recommends 3 real restaurants and lets you
figure out what to order once you're there.

### 4. Housekeeping
- ~~`git init`~~ — done. Pushed to a private GitHub repo, `.gitignore` covers
  `.env` (verified nothing secret ever got staged).
- ~~License~~ — done, MIT (see `LICENSE`). Covers the original code only —
  it doesn't and can't license Nintendo's "WarioWare" trademark, which this
  project doesn't use, only references as inspiration (see disclaimer at top).
- `public/assets/` is empty; everything is drawn with Phaser primitives and
  system fonts. Sound would add a lot — WarioWare is half audio.
- Still open, worth doing before making the repo public:
  - A screenshot or short GIF of a run in the README — nothing here shows
    what it actually looks like yet.
  - Repo description + topics on GitHub itself (`gh repo edit --description
    ... --add-topic ...`) — helps it read as a finished project, not a dump.
  - Third-party attribution: Phaser (MIT, loaded via CDN in `index.html`) and
    the Bungee / Space Grotesk Google Fonts (both OFL-licensed) — fine to use
    as-is, just worth a line crediting them if this goes public.
- ~~`package.json` `license`/`repository`/`homepage`/`bugs` fields~~ — done,
  pointing at `github.com/TangoMango223/mighty-food-time`.

---

## License

[MIT](./LICENSE) — the original code in this repo, free to use, modify, and
redistribute. This does not extend to, and this project claims no rights over,
Nintendo's "WarioWare" trademark or any other third-party IP referenced only
as inspiration (see the disclaimer at the top of this file).
