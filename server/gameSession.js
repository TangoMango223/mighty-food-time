/**
 * gameSession.js
 * ---------------
 * One GameSession = one player's run through the microgames.
 *
 * Design note: the SERVER owns the game order, the outcomes, and the scoring.
 * The browser only reports "here's what happened in the game you told me to run".
 * That keeps game logic in one place and means a future multiplayer version
 * (or a replay, or an anti-cheat check) needs no rewrite.
 */

export const GAME_CATALOG = [
  { id: 'mash',        title: 'MASH!',        prompt: 'MASH THE BUTTON!',     durationMs: 5000 },
  { id: 'dodge',       title: 'DODGE!',       prompt: 'DODGE THE FALLING STUFF!', durationMs: 6000 },
  { id: 'simon',       title: 'REPEAT!',      prompt: 'REPEAT THE PATTERN!',  durationMs: 8000 },
  { id: 'dont-touch',  title: '???',          prompt: "DON'T TOUCH IT!",      durationMs: 5000 },
  { id: 'odd-one-out', title: 'ODD ONE OUT!', prompt: 'FIND THE ODD ONE!',    durationMs: 6000 },
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class GameSession {
  constructor(id) {
    this.id = id;
    this.createdAt = Date.now();
    // WarioWare shuffles its microgames; so do we.
    this.gameOrder = shuffle(GAME_CATALOG);
    this.currentIndex = -1;
    this.outcomes = [];
  }

  get totalGames() {
    return this.gameOrder.length;
  }

  /** Advance to the next game. Returns null when the run is over. */
  nextGame() {
    this.currentIndex += 1;
    if (this.currentIndex >= this.gameOrder.length) return null;
    return {
      ...this.gameOrder[this.currentIndex],
      index: this.currentIndex,
      total: this.gameOrder.length,
    };
  }

  get currentGame() {
    return this.gameOrder[this.currentIndex] ?? null;
  }

  /**
   * Record what happened in a microgame.
   * result: 'success' | 'fail' | 'secret'
   * meta:   free-form per-game detail (taps, reaction time, what they pressed...)
   */
  recordOutcome({ gameId, result, meta = {} }) {
    const outcome = {
      gameId,
      result: ['success', 'fail', 'secret'].includes(result) ? result : 'fail',
      meta,
      at: Date.now(),
    };
    this.outcomes.push(outcome);
    return outcome;
  }

  get isComplete() {
    return this.outcomes.length >= this.gameOrder.length;
  }

  get score() {
    return this.outcomes.filter((o) => o.result === 'success').length;
  }

  /**
   * Turn raw outcomes into a "player profile" — the deterministic feature
   * extraction step. The LLM never sees raw game events, only these traits.
   *
   * This is the pattern worth internalizing: do the reliable, testable work in
   * code, and let the model handle only the part that genuinely needs
   * creativity (the voice, the dish choice, the joke).
   */
  buildProfile() {
    const by = (id) => this.outcomes.find((o) => o.gameId === id);
    const wins = this.outcomes.filter((o) => o.result === 'success');
    const losses = this.outcomes.filter((o) => o.result === 'fail');
    const secrets = this.outcomes.filter((o) => o.result === 'secret');

    const traits = [];

    // --- Secret / hidden conditions -------------------------------------
    if (wins.length === this.outcomes.length && this.outcomes.length > 0) {
      traits.push('FLAWLESS_RUN: won every single microgame');
    }
    if (losses.length === this.outcomes.length && this.outcomes.length > 0) {
      traits.push('TOTAL_GREMLIN: lost every single microgame');
    }
    if (secrets.length > 0) {
      traits.push(`SECRET_UNLOCKED: triggered a hidden condition in ${secrets.map((s) => s.gameId).join(', ')}`);
    }

    // --- Per-game personality reads --------------------------------------
    const dontTouch = by('dont-touch');
    if (dontTouch?.result === 'fail') traits.push('NO_IMPULSE_CONTROL: could not resist pressing the forbidden button');
    if (dontTouch?.result === 'success') traits.push('IRON_WILL: successfully did nothing when tempted');

    const mash = by('mash');
    if (mash?.result === 'success' && (mash.meta.taps ?? 0) > 40) traits.push('FERAL_ENERGY: absurd button-mashing speed');
    if (mash?.result === 'fail') traits.push('LOW_BATTERY: could not muster the taps');

    const simon = by('simon');
    if (simon?.result === 'fail') traits.push('GOLDFISH_MEMORY: fumbled the pattern');
    if (simon?.result === 'success') traits.push('SHARP_RECALL: nailed the pattern');

    const odd = by('odd-one-out');
    if (odd?.result === 'success') traits.push('EAGLE_EYE: spotted the odd one out');
    if (odd?.result === 'fail') traits.push('OBLIVIOUS: missed the obvious mismatch');

    const dodge = by('dodge');
    if (dodge?.result === 'success') traits.push('NIMBLE: dodged everything');
    if (dodge?.result === 'fail') traits.push('TOOK_THE_HIT: got clobbered');

    // --- Overall vibe bucket ---------------------------------------------
    const ratio = this.outcomes.length ? wins.length / this.outcomes.length : 0;
    let vibe;
    if (ratio === 1) vibe = 'TRIUMPHANT';
    else if (ratio >= 0.6) vibe = 'COMPETENT';
    else if (ratio >= 0.3) vibe = 'MESSY';
    else vibe = 'CATASTROPHIC';

    return {
      sessionId: this.id,
      score: wins.length,
      total: this.outcomes.length,
      vibe,
      traits,
      outcomes: this.outcomes.map((o) => ({ gameId: o.gameId, result: o.result, meta: o.meta })),
    };
  }
}
