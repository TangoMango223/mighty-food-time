import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3000');
const log = (...a) => console.log(...a);
let tokenCount = 0;

// Pretend to play: win some, lose some, and trigger the secret on dont-touch.
const SCRIPTED = {
  'mash':        { result: 'success', meta: { taps: 45 } },
  'dodge':       { result: 'fail',    meta: { reason: 'hit' } },
  'simon':       { result: 'success', meta: { length: 3 } },
  'dont-touch':  { result: 'secret',  meta: { reason: 'stared-it-down' } },
  'odd-one-out': { result: 'fail',    meta: { reason: 'wrong-item' } },
};

ws.on('open', () => { log('→ start'); ws.send(JSON.stringify({ type: 'start' })); });

ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  switch (msg.type) {
    case 'session_started':
      log(`← session_started (${msg.totalGames} games)`); break;
    case 'load_game': {
      const play = SCRIPTED[msg.game.id];
      log(`← load_game: ${msg.game.id}  →  replying ${play.result}`);
      setTimeout(() => ws.send(JSON.stringify({ type: 'game_result', gameId: msg.game.id, ...play })), 30);
      break;
    }
    case 'outcome_ack':
      log(`← outcome_ack: score ${msg.score}/${msg.total}`); break;
    case 'thinking_start':
      log(`← thinking_start — traits: ${msg.profile.traits.length}, vibe: ${msg.profile.vibe}`); break;
    case 'thinking_token':
      tokenCount++; process.stdout.write('.'); break;
    case 'recommendation':
      log(`\n← recommendation after ${tokenCount} streamed chunks`);
      log('   VERDICT:', msg.payload.verdict);
      for (const [i, r] of msg.payload.restaurants.entries()) {
        log(`   REST ${i + 1} :`, r.name, '—', r.reason);
        log('           ', r.address, r.rating != null ? `(★ ${r.rating})` : '');
        log('           ', r.mapsUri, r.photoUrl ? '[photo]' : '[no photo]');
      }
      log('   DARE   :', msg.payload.dare);
      log('   source :', msg.payload.source);
      log('\nPASS: full loop works end to end.');
      ws.close(); process.exit(0);
    case 'game_over':
      log('← GAME OVER:', msg.message); ws.close(); process.exit(1);
    case 'error':
      log('← ERROR:', msg.message); ws.close(); process.exit(1);
  }
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 25000);
