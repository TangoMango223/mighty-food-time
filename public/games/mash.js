import { BaseGameScene } from './base.js';

/** MASH! — hit the button as many times as you can before time runs out. */
export class MashScene extends BaseGameScene {
  constructor() { super('mash'); }

  setup() {
    const { width, height } = this.scale;
    this.taps = 0;
    this.target = 22;

    this.button = this.add.circle(width / 2, height / 2 + 10, 78, 0xff2e88)
      .setStrokeStyle(6, 0x000000).setInteractive({ useHandCursor: true });

    this.add.text(width / 2, height / 2 + 10, 'TAP', {
      fontFamily: 'Bungee, sans-serif', fontSize: '32px', color: '#12071f',
    }).setOrigin(0.5);

    this.counter = this.add.text(width / 2, height - 46, `0 / ${this.target}`, {
      fontFamily: 'Bungee, sans-serif', fontSize: '24px', color: '#fff6e5',
      stroke: '#000', strokeThickness: 5,
    }).setOrigin(0.5);

    const tap = () => this.registerTap();
    this.button.on('pointerdown', tap);
    this.input.keyboard.on('keydown-SPACE', tap);
  }

  registerTap() {
    if (this.settled) return;
    this.taps += 1;
    this.counter.setText(`${this.taps} / ${this.target}`);

    // Juice: squash the button and kick the counter every tap.
    this.button.setScale(0.9);
    this.tweens.add({ targets: this.button, scale: 1, duration: 90, ease: 'Quad.easeOut' });

    if (this.taps >= this.target) {
      // Mashing well past the target is its own kind of unhinged.
      this.finish('success', { taps: this.taps });
    }
  }

  onTimeout() {
    this.finish(this.taps >= this.target ? 'success' : 'fail', { taps: this.taps });
  }
}
