/**
 * client.js — the runner.
 *
 * Owns three things:
 *   1. the WebSocket connection to the server
 *   2. one Phaser.Game instance with every microgame registered on it
 *   3. the DOM screens layered over the canvas (title / thinking / result / game-over)
 *
 * The server is in charge of WHAT happens next. This file just reacts to
 * messages and reports outcomes back. Every branch of the game flow is one
 * `case` in handleMessage() — that's the whole state machine.
 */

import { MashScene } from './games/mash.js';
import { DodgeScene } from './games/dodge.js';
import { SimonScene } from './games/simon.js';
import { DontTouchScene } from './games/dontTouch.js';
import { OddOneOutScene } from './games/oddOneOut.js';

const SCENES = {
  'mash': MashScene,
  'dodge': DodgeScene,
  'simon': SimonScene,
  'dont-touch': DontTouchScene,
  'odd-one-out': OddOneOutScene,
};

const $ = (id) => document.getElementById(id);
const SCREENS = ['screen-title', 'screen-flash', 'screen-thinking', 'screen-result', 'screen-gameover'];

function showScreen(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
}
function hideScreens() {
  for (const s of SCREENS) $(s).classList.add('hidden');
}

/* ---------------- Phaser bootstrap ---------------- */

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 640,
  height: 480,
  parent: 'phaser-root',
  backgroundColor: '#0b0416',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
});

// Register every scene up front, but don't start any of them.
for (const [key, SceneClass] of Object.entries(SCENES)) {
  game.scene.add(key, SceneClass, false);
}

/* ---------------- WebSocket ---------------- */

let socket = null;
let totalGames = 5;

function connect() {
  socket = new WebSocket(`ws://${location.host}`);

  socket.addEventListener('open', () => {
    $('hud-conn').textContent = 'live';
    $('hud-conn').className = 'conn-on';
  });

  socket.addEventListener('close', () => {
    $('hud-conn').textContent = 'offline';
    $('hud-conn').className = 'conn-off';
  });

  socket.addEventListener('message', (event) => {
    handleMessage(JSON.parse(event.data));
  });
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

/* ---------------- Game flow ---------------- */

function handleMessage(msg) {
  switch (msg.type) {
    case 'session_started': {
      totalGames = msg.totalGames;
      $('hud-score').textContent = '○'.repeat(totalGames);
      break;
    }

    case 'load_game': {
      // Quick "get ready" beat before the game appears — very WarioWare.
      $('hud-progress').textContent = `GAME ${msg.game.index + 1}/${msg.game.total}`;
      $('flash-text').textContent = msg.game.prompt;
      showScreen('screen-flash');
      setTimeout(() => {
        hideScreens();
        startGame(msg.game);
      }, 900);
      break;
    }

    case 'outcome_ack': {
      const filled = '●'.repeat(msg.score);
      const empty = '○'.repeat(Math.max(0, msg.total - msg.score));
      $('hud-score').textContent = filled + empty;
      break;
    }

    case 'thinking_start': {
      $('thinking-stream').textContent = '';
      $('profile-chips').innerHTML = msg.profile.traits
        .map((t) => `<span class="chip">${t.split(':')[0]}</span>`)
        .join('');
      $('hud-progress').textContent = 'VERDICT';
      showScreen('screen-thinking');
      break;
    }

    // The payoff: each token the model produces lands here the moment the
    // server receives it, so the text visibly types itself out.
    case 'thinking_token': {
      $('thinking-stream').textContent += msg.text;
      break;
    }

    case 'recommendation': {
      renderResult(msg.payload);
      break;
    }

    // No fallback data exists server-side — this means streamRecommendation
    // couldn't produce a real, grounded result. Show a dead end, not a fake one.
    case 'game_over': {
      $('gameover-message').textContent = msg.message || 'Something went wrong.';
      showScreen('screen-gameover');
      break;
    }

    case 'error': {
      $('thinking-stream').textContent += `\n\n[error] ${msg.message}`;
      break;
    }
  }
}

function startGame(def) {
  const key = def.id;
  if (!SCENES[key]) {
    console.warn(`No scene registered for "${key}"`);
    send({ type: 'game_result', gameId: key, result: 'fail', meta: { reason: 'missing scene' } });
    return;
  }
  game.scene.stop(key); // safe if it never ran; makes replays clean
  game.scene.start(key, {
    game: def,
    onComplete: (result, meta) => {
      send({ type: 'game_result', gameId: key, result, meta });
      game.scene.stop(key);
    },
  });
}

function buildRestaurantCard(r, index) {
  const card = document.createElement('div');
  card.className = 'rest-card';

  const img = document.createElement('img');
  img.className = 'rest-photo';
  img.alt = r.name || '';
  img.loading = 'lazy';
  if (r.photoUrl) {
    img.src = r.photoUrl;
    img.onerror = () => { img.replaceWith(placeholderPhoto()); };
    card.appendChild(img);
  } else {
    card.appendChild(placeholderPhoto());
  }

  const body = document.createElement('div');
  body.className = 'rest-body';

  const head = document.createElement('div');
  head.className = 'rest-head';
  const rank = document.createElement('span');
  rank.className = 'pill';
  rank.textContent = `#${index + 1}`;
  head.appendChild(rank);
  if (r.rating != null) {
    const rating = document.createElement('span');
    rating.className = 'pill pill-muted';
    rating.textContent = `★ ${r.rating}`;
    head.appendChild(rating);
  }
  body.appendChild(head);

  const name = document.createElement('h3');
  name.className = 'rest-name';
  name.textContent = r.name || 'Unnamed spot';
  body.appendChild(name);

  if (r.address) {
    const addr = document.createElement('p');
    addr.className = 'rest-address';
    addr.textContent = r.address;
    body.appendChild(addr);
  }

  if (r.reason) {
    const reason = document.createElement('p');
    reason.className = 'rest-reason';
    reason.textContent = r.reason;
    body.appendChild(reason);
  }

  if (r.mapsUri) {
    const link = document.createElement('a');
    link.className = 'rest-link';
    link.href = r.mapsUri;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'View on Google Maps →';
    body.appendChild(link);
  }

  card.appendChild(body);
  return card;
}

function placeholderPhoto() {
  const div = document.createElement('div');
  div.className = 'rest-photo rest-photo-empty';
  div.textContent = '🍽️';
  return div;
}

function renderResult(p) {
  $('result-verdict').textContent = p.verdict || 'The machine has spoken.';
  $('result-dare').textContent = p.dare || '';
  $('result-restaurants').replaceChildren(...(p.restaurants ?? []).map(buildRestaurantCard));
  showScreen('screen-result');
}

/* ---------------- Buttons ---------------- */

$('btn-start').addEventListener('click', () => {
  hideScreens();
  send({ type: 'start' });
});

$('btn-again').addEventListener('click', () => {
  hideScreens();
  send({ type: 'restart' });
});

$('btn-gameover-again').addEventListener('click', () => {
  hideScreens();
  send({ type: 'restart' });
});

/* ---------------- Boot ---------------- */

fetch('/api/health')
  .then((r) => r.json())
  .then((h) => { $('ai-mode').textContent = `AI mode: ${h.aiMode}`; })
  .catch(() => { $('ai-mode').textContent = 'server unreachable'; });

connect();
showScreen('screen-title');
