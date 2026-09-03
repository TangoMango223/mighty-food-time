/**
 * server.js
 * ---------
 * Express serves the front end. A WebSocket server runs alongside it on the
 * same HTTP server and drives the actual game session.
 *
 * Why WebSockets instead of plain HTTP requests?
 *  - The server pushes. It decides which microgame comes next and tells the
 *    browser, rather than the browser asking "what now?" after every game.
 *  - One connection stays open for the whole run, so the session state lives
 *    naturally alongside it.
 *  - When the AI response streams in, we forward tokens down that SAME open
 *    socket as they arrive. With request/response HTTP you'd be polling or
 *    reaching for SSE.
 *
 * PROTOCOL (all messages are JSON objects with a `type` field)
 *
 *   client -> server
 *     { type: 'start' }                                  begin a run
 *     { type: 'game_result', gameId, result, meta }      report one microgame
 *     { type: 'restart' }                                play again
 *
 *   server -> client
 *     { type: 'session_started', sessionId, totalGames }
 *     { type: 'load_game', game: {id,title,prompt,durationMs,index,total} }
 *     { type: 'outcome_ack', gameId, result, score, index, total }
 *     { type: 'thinking_start', profile }
 *     { type: 'thinking_token', text }
 *     { type: 'recommendation', payload, profile }
 *     { type: 'game_over', message }                      recommendation failed — no fallback data
 *     { type: 'error', message }                           protocol-level error (bad message, etc.)
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { GameSession } from './gameSession.js';
import { streamRecommendation } from './decisionEngine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(join(__dirname, '..', 'public')));

// Handy for debugging: shows whether your keys were picked up, without leaking them.
// There is no offline mode — both keys are required or the game ends in a game-over screen.
app.get('/api/health', (_req, res) => {
  const openaiKey = process.env.OPENAI_API_KEY;
  const hasOpenAI = Boolean(openaiKey) && !openaiKey.startsWith('sk-your-key');
  const hasMaps = Boolean(process.env.GOOGLE_MAPS_API_KEY);
  const missing = [!hasOpenAI && 'OPENAI_API_KEY', !hasMaps && 'GOOGLE_MAPS_API_KEY'].filter(Boolean);
  res.json({
    ok: true,
    aiMode: missing.length ? `missing ${missing.join(' + ')}` : 'ready',
    model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
  });
});

// Proxies a Google Places photo so the API key never reaches the browser.
// `name` must be exactly the resource name Places returned (places/{id}/photos/{id}) —
// validated before it's interpolated into the upstream URL.
app.get('/api/place-photo', async (req, res) => {
  const name = req.query.name;
  if (typeof name !== 'string' || !/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(name)) {
    return res.status(400).end();
  }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return res.status(404).end();

  try {
    const upstream = await fetch(
      `https://places.googleapis.com/v1/${name}/media?maxWidthPx=480&key=${encodeURIComponent(apiKey)}`
    );
    if (!upstream.ok) return res.status(upstream.status).end();
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

/** sessionId -> GameSession. In-memory is fine: single player, one machine. */
const sessions = new Map();

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

wss.on('connection', (ws) => {
  let session = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  console.log('[ws] client connected');

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: 'error', message: 'Malformed JSON' });
    }

    switch (msg.type) {
      case 'start':
      case 'restart': {
        session = new GameSession(randomUUID());
        sessions.set(session.id, session);
        console.log(`[session ${session.id.slice(0, 8)}] started`);
        send(ws, { type: 'session_started', sessionId: session.id, totalGames: session.totalGames });
        send(ws, { type: 'load_game', game: session.nextGame() });
        break;
      }

      case 'game_result': {
        if (!session) return send(ws, { type: 'error', message: 'No active session — send {type:"start"} first.' });

        const outcome = session.recordOutcome({
          gameId: msg.gameId,
          result: msg.result,
          meta: msg.meta ?? {},
        });
        console.log(`[session ${session.id.slice(0, 8)}] ${outcome.gameId} -> ${outcome.result}`);

        send(ws, {
          type: 'outcome_ack',
          gameId: outcome.gameId,
          result: outcome.result,
          score: session.score,
          index: session.outcomes.length,
          total: session.totalGames,
        });

        if (!session.isComplete) {
          send(ws, { type: 'load_game', game: session.nextGame() });
          break;
        }

        // ---- Run is over: hand the profile to the AI. ----
        const profile = session.buildProfile();
        send(ws, { type: 'thinking_start', profile });

        try {
          // The callback is the whole trick: every token the model produces
          // gets pushed straight down this socket as it arrives.
          const payload = await streamRecommendation(profile, (text) => {
            send(ws, { type: 'thinking_token', text });
          });
          send(ws, { type: 'recommendation', payload, profile });
          const names = payload.restaurants.map((r) => r.name).join(', ');
          console.log(`[session ${session.id.slice(0, 8)}] verdict: ${names} (${payload.source})`);
        } catch (err) {
          console.error('[decision engine]', err.message);
          send(ws, { type: 'game_over', message: err.message });
        }
        break;
      }

      default:
        send(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
    }
  });

  ws.on('close', () => {
    console.log('[ws] client disconnected');
    if (session) sessions.delete(session.id);
  });
});

// Drop connections that have gone silent (laptop slept, tab closed hard, etc).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`\n  Mighty Fooding Time running -> http://localhost:${PORT}\n`);
});
