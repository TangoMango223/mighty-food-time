import { BaseGameScene } from './base.js';

const ARROWS = [
  { key: 'LEFT',  glyph: '←' },
  { key: 'RIGHT', glyph: '→' },
  { key: 'UP',    glyph: '↑' },
  { key: 'DOWN',  glyph: '↓' },
];

/** REPEAT! — watch a short arrow pattern, then play it back. */
export class SimonScene extends BaseGameScene {
  setup() {
    const { width, height } = this.scale;

    this.sequence = Array.from({ length: 3 }, () => Phaser.Utils.Array.GetRandom(ARROWS));
    this.playerIndex = 0;
    this.accepting = false;

    this.display = this.add.text(width / 2, height / 2, '', {
      fontFamily: 'Bungee, sans-serif', fontSize: '92px', color: '#ffd93d',
      stroke: '#000', strokeThickness: 8,
    }).setOrigin(0.5);

    this.status = this.add.text(width / 2, height - 54, 'WATCH…', {
      fontFamily: 'Bungee, sans-serif', fontSize: '20px', color: '#fff6e5',
      stroke: '#000', strokeThickness: 5,
    }).setOrigin(0.5);

    this.showSequence();

    this.input.keyboard.on('keydown', (e) => {
      if (!this.accepting || this.settled) return;
      const pressed = e.key.replace('Arrow', '').toUpperCase();
      if (!ARROWS.some((a) => a.key === pressed)) return;

      const expected = this.sequence[this.playerIndex];
      if (pressed !== expected.key) {
        this.display.setText('✗').setColor('#ff6b6b');
        this.finish('fail', { reason: 'wrong-arrow', gotTo: this.playerIndex });
        return;
      }

      this.display.setText(expected.glyph).setColor('#22e3d6');
      this.playerIndex += 1;
      this.status.setText(`${this.playerIndex} / ${this.sequence.length}`);

      if (this.playerIndex >= this.sequence.length) {
        this.finish('success', { length: this.sequence.length });
      }
    });
  }

  /** Flash each arrow in turn, then hand control to the player. */
  showSequence() {
    this.sequence.forEach((step, i) => {
      this.time.delayedCall(i * 700, () => {
        if (this.settled) return;
        this.display.setText(step.glyph).setColor('#ffd93d');
        this.time.delayedCall(420, () => { if (!this.settled) this.display.setText(''); });
      });
    });

    this.time.delayedCall(this.sequence.length * 700 + 150, () => {
      if (this.settled) return;
      this.accepting = true;
      this.status.setText('YOUR TURN!');
      this.display.setText('?').setColor('#ff2e88');
    });
  }
}
