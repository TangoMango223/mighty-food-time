import { BaseGameScene } from './base.js';

/**
 * DON'T TOUCH IT! — the classic subversion. Doing nothing is correct.
 *
 * Secret condition: hover over the button for most of the round without
 * clicking. You stared it down. That unlocks a hidden outcome.
 */
export class DontTouchScene extends BaseGameScene {
  setup() {
    const { width, height } = this.scale;
    this.hoverMs = 0;
    this.lastTick = this.time.now;

    this.button = this.add.circle(width / 2, height / 2 + 10, 86, 0xff2e88)
      .setStrokeStyle(6, 0x000000)
      .setInteractive({ useHandCursor: true });

    this.add.text(width / 2, height / 2 + 10, 'PRESS\nME', {
      fontFamily: 'Bungee, sans-serif', fontSize: '30px', color: '#12071f',
      align: 'center', lineSpacing: -6,
    }).setOrigin(0.5);

    this.add.text(width / 2, height - 46, 'do not press me', {
      fontFamily: 'Space Grotesk, sans-serif', fontSize: '15px', color: '#8f7aa8',
    }).setOrigin(0.5);

    // Tempting pulse — makes it much harder to leave alone.
    this.tweens.add({
      targets: this.button, scale: 1.12, duration: 520,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    this.hovering = false;
    this.button.on('pointerover', () => { this.hovering = true; });
    this.button.on('pointerout', () => { this.hovering = false; });

    const press = () => this.finish('fail', { reason: 'pressed-it', hoverMs: Math.round(this.hoverMs) });
    this.button.on('pointerdown', press);
    this.input.keyboard.on('keydown-SPACE', press);
  }

  tick() {
    const now = this.time.now;
    if (this.hovering) this.hoverMs += now - this.lastTick;
    this.lastTick = now;
  }

  onTimeout() {
    const stared = this.hoverMs > this.def.durationMs * 0.6;
    this.finish(stared ? 'secret' : 'success', {
      reason: stared ? 'stared-it-down' : 'left-it-alone',
      hoverMs: Math.round(this.hoverMs),
    });
  }
}
