/**
 * base.js — the contract every microgame follows.
 *
 * A microgame subclasses BaseGameScene and implements setup(). When the player
 * wins or loses, it calls this.finish('success' | 'fail' | 'secret', meta).
 * Everything else — the countdown bar, the prompt banner, the timeout, the
 * win/lose flash, reporting back to the runner — is handled here once.
 *
 * Adding a sixth game later means writing setup() and nothing else.
 */
export class BaseGameScene extends Phaser.Scene {
  init(data) {
    this.def = data.game;              // {id,title,prompt,durationMs,index,total}
    this.onComplete = data.onComplete; // callback the runner passes in
    this.settled = false;
  }

  create() {
    const { width } = this.scale;
    this.cameras.main.setBackgroundColor('#0b0416');

    this.add.text(width / 2, 38, this.def.prompt, {
      fontFamily: 'Bungee, sans-serif', fontSize: '28px', color: '#ffd93d',
      stroke: '#000', strokeThickness: 6, align: 'center',
    }).setOrigin(0.5).setDepth(10);

    // Countdown bar across the top.
    this.add.rectangle(width / 2, 8, width - 16, 10, 0x2a1544).setDepth(10);
    this.timerBar = this.add.rectangle(8, 8, width - 16, 10, 0xff2e88)
      .setOrigin(0, 0.5).setDepth(11);

    this.startedAt = this.time.now;
    this.timeoutEvent = this.time.delayedCall(this.def.durationMs, () => this.onTimeout());

    this.setup();
  }

  update() {
    if (this.settled) return;
    const remaining = Math.max(0, 1 - (this.time.now - this.startedAt) / this.def.durationMs);
    this.timerBar.width = (this.scale.width - 16) * remaining;
    this.timerBar.fillColor = remaining < 0.25 ? 0xff3b3b : 0xff2e88;
    this.tick?.();
  }

  /** Ran out of time. Most games treat that as a loss; override to change. */
  onTimeout() {
    this.finish('fail', { reason: 'timeout' });
  }

  /** Call this exactly once per game. Extra calls are ignored on purpose. */
  finish(result, meta = {}) {
    if (this.settled) return;
    this.settled = true;
    this.timeoutEvent?.remove();

    const elapsedMs = Math.round(this.time.now - this.startedAt);
    const { width, height } = this.scale;

    const label = result === 'success' ? 'NICE!' : result === 'secret' ? '???' : 'MISSED!';
    const color = result === 'success' ? '#22e3d6' : result === 'secret' ? '#ff2e88' : '#ff6b6b';

    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.55).setDepth(20);
    const banner = this.add.text(width / 2, height / 2, label, {
      fontFamily: 'Bungee, sans-serif', fontSize: '56px', color,
      stroke: '#000', strokeThickness: 8,
    }).setOrigin(0.5).setDepth(21).setScale(0.5);

    this.tweens.add({ targets: banner, scale: 1, duration: 220, ease: 'Back.easeOut' });

    this.time.delayedCall(900, () => this.onComplete(result, { ...meta, elapsedMs }));
  }

  /** Subclasses implement this. */
  setup() {}
}
